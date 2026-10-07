"""The contract fixtures the frontend tests load are what the server answers today.

`tools/notebook_contract_fixtures.py` asks the real wave 12 to 15 Notebook routers for their
answers and writes them under `app/src/pages/journal-2-0/__fixtures__/contract/`. The frontend
tests of those surfaces load the files instead of typing a response by hand.

This file is what keeps the two halves tied:

  * the committed fixtures are regenerated in memory and compared, so a server change that moves
    a shape FAILS HERE until somebody regenerates on purpose
    (`python tools/notebook_contract_fixtures.py`), and the regenerated files then run through
    the frontend tests that consume them;
  * two runs are byte-identical (the frozen clock and the seeded ids hold);
  * a CONTROL changes one server shape and proves the comparison names the fixture;
  * every route on those routers has a pinned answer, read from the routers, never from a list.

One defect found while building it is pinned at the bottom as a strict xfail (D1).
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import notebook_contract_fixtures as gen  # noqa: E402

REGENERATE = "python tools/notebook_contract_fixtures.py"


@pytest.fixture(scope="module")
def fresh() -> dict[str, str]:
    return gen.generate()


# ── the rail ──────────────────────────────────────────────────────────────────────────────

def test_the_committed_fixtures_are_what_the_server_answers_today(fresh):
    on_disk = gen.committed()
    assert on_disk, f"no committed fixtures in {gen.FIXTURE_DIR}; run `{REGENERATE}`"      # non-vacuity
    problems = gen.diff(fresh, on_disk)
    assert not problems, (
        "The server's answers no longer match the committed contract fixtures.\n"
        "If the server change is intended, regenerate on purpose and run the frontend tests that "
        f"load these files:\n    {REGENERATE}\n\n" + "\n".join(problems))


def test_two_runs_are_byte_identical(fresh):
    again = gen.generate()
    moved = sorted(n for n in set(fresh) | set(again) if fresh.get(n) != again.get(n))
    assert not moved, f"these fixtures are not repeatable (a clock or an id is not pinned): {moved}"


def test_every_fixture_is_in_the_generators_own_form():
    """A fixture edited by hand would still parse, and would then differ from the generator's
    text for a reason that has nothing to do with the server. (Text, not bytes: git may check
    the files out with either line ending on this box.)"""
    files = sorted(gen.FIXTURE_DIR.glob("*.json"))
    assert len(files) > 100                                                                 # non-vacuity
    for path in files:
        text = path.read_text(encoding="utf-8")
        payload = json.loads(text)
        assert set(payload) == {"_contract", "body"}, path.name
        assert text == gen._render(payload), f"{path.name} is not in the generator's own form"


# ── controls: the comparison can fail, and it names what moved ──────────────────────────────────

def test_CONTROL_a_server_shape_change_is_caught_and_named(fresh, monkeypatch):
    """Rename one key the setups board returns. The comparison must go red on exactly the board's
    successful answers (and on nothing else), and say which key moved."""
    from api.services.journal_two import setups_board
    real = setups_board.build_cards

    def renamed(*args, **kwargs):
        out = dict(real(*args, **kwargs))
        out["items"] = out.pop("cards")
        return out

    monkeypatch.setattr(setups_board, "build_cards", renamed)
    problems = gen.diff(gen.generate(), fresh)
    named = sorted(p.split(" ")[1] for p in problems)
    board_answers = sorted(n for n, text in fresh.items()
                           if n.startswith("setups-board") and json.loads(text)["_contract"]["status"] == 200)
    assert len(board_answers) >= 2, board_answers                                            # non-vacuity
    assert named == board_answers, problems
    assert all(p.startswith("differs: ") and "`" in p for p in problems), problems


def test_CONTROL_a_changed_sentence_is_caught(fresh, monkeypatch):
    """An error sentence is part of the contract: the client renders it."""
    from api.routers import notebook_entry_context
    monkeypatch.setattr(notebook_entry_context, "NO_CONTEXT_SENTENCE", "Nothing to attach that to.")
    problems = gen.diff(gen.generate(), fresh)
    assert [p.split(" ")[1] for p in problems] == ["entry-context.why.no-context"], problems


def test_CONTROL_missing_and_extra_files_are_named_not_counted():
    fresh_ = {"a": "1\n", "b": "2\n", "c": "x\ny\n"}
    disk = {"b": "2\n", "c": "x\nz\n", "d": "4\n"}
    assert gen.diff(fresh_, disk) == [
        "missing on disk: a",
        "on disk but no longer generated: d",
        "differs: c (line 2: committed `z` / server now `y`)",
    ]
    assert gen.diff(fresh_, dict(fresh_)) == []


# ── coverage: every route has a pinned answer ──────────────────────────────────────────────────

#: Routes with no SUCCESSFUL answer recorded, each with the reason. A success here needs a stored
#: vendor artefact (a transcript, a nightly similar-names row, a live fingerprint computation) the
#: generator deliberately does not fabricate. Their refusals and both sweeps are recorded.
NO_SUCCESS_RECORDED = {
    ("GET", "/api/j2/similar-names/{note_id}/{embed_key}"): "reads only rows the nightly precompute stored",
    ("GET", "/api/j2/research-capture/transcripts/{symbol}/{quarter}"): "needs a stored vendor transcript",
    ("POST", "/api/j2/research-capture/transcripts/save"): "needs a stored vendor transcript",
    ("POST", "/api/j2/notebook-fingerprint/blocks/{note_id}/{embed_key}/freeze"): "freezes a live computation",
}


def _recorded():
    out = []
    for name, text in gen.committed().items():
        meta = json.loads(text)["_contract"]
        if meta["path"]:
            method, _, _ = meta["endpoint"].partition(" ")
            out.append((name, method, meta["path"].split("?")[0], meta["status"]))
    return out


def test_every_route_has_a_pinned_answer_and_both_sweeps():
    app = gen.build_app()
    table = gen.route_table(app)
    assert len(table) >= 40, table                                                          # non-vacuity
    recorded = _recorded()
    committed = gen.committed()
    signed_out = json.loads(committed["sweep.signed-out"])["body"]
    flags_off = json.loads(committed["sweep.flags-off"])["body"]
    missing = []
    for route in app.routes:
        for method in sorted(getattr(route, "methods", None) or ()):
            key = (method, route.path)
            if key not in table:
                continue
            hits = [(n, s) for n, m, p, s in recorded if m == method and route.path_regex.match(p)]
            if not any(200 <= s < 300 for _, s in hits) and key not in NO_SUCCESS_RECORDED:
                missing.append(f"{method} {route.path}: no successful answer recorded")
            label = f"{method} {route.path}"
            if signed_out.get(label, {}).get("status") != 401:
                missing.append(f"{label}: not in the signed-out sweep as a 401")
            if flags_off.get(label, {}).get("status") != 404:
                missing.append(f"{label}: not in the flags-off sweep as a 404")
    assert not missing, "\n".join(missing)
    stale = sorted(k for k in NO_SUCCESS_RECORDED if k not in table)
    assert not stale, f"NO_SUCCESS_RECORDED names routes that no longer exist: {stale}"


def test_every_error_the_client_can_be_handed_carries_a_detail():
    """`detail` is what every client in this wave renders. It is a sentence everywhere except
    FastAPI's own validation answer, where it is a LIST. Those are named here, so a route
    gaining or losing a body parameter is a deliberate change."""
    lists, bad = [], []
    for name, text in gen.committed().items():
        payload = json.loads(text)
        status = payload["_contract"]["status"]
        if not isinstance(status, int) or status < 400 or name.startswith("sweep."):
            continue
        detail = payload["body"].get("detail") if isinstance(payload["body"], dict) else None
        if isinstance(detail, list):
            lists.append(name)
        elif not (isinstance(detail, str) and detail.strip()):
            bad.append(name)
    assert not bad, f"an error answer with no sentence: {bad}"
    assert sorted(lists) == [
        "passed-setups.add.body-not-an-object",
        "review-drafts.daily.missing-day",
        "thesis-chips.body-not-an-object",
        "transcripts.save.body-not-an-object",
    ]


def test_the_generator_runs_on_a_temporary_database_and_refuses_the_network():
    src = (ROOT / "tools" / "notebook_contract_fixtures.py").read_text(encoding="utf-8")
    assert src.index("import conftest") < src.index("def build_app"), "conftest must be imported first"
    before = len(gen.NETWORK_ATTEMPTS)
    p = gen._Patches()
    try:
        gen._no_network(p)
        import socket
        s = socket.socket()
        try:
            with pytest.raises(OSError, match="outbound connection refused"):
                s.connect(("203.0.113.7", 9))            # TEST-NET-3: never a real host
        finally:
            s.close()
    finally:
        p.undo()
    assert gen.NETWORK_ATTEMPTS[before:] == ["203.0.113.7"]
    del gen.NETWORK_ATTEMPTS[before:]


# ── D1: a defect this work found, kept visible ────────────────────────────────────────────────

@pytest.mark.xfail(strict=True, reason=(
    "DEFECT D1 (docs/notebook/fin-tests.md): POST /api/j2/thesis-chips answers 500 "
    "(sqlite3.OperationalError: no such table: j2_note_levels) until the resurfacing lane has "
    "projected a note. api/services/journal_two/thesis_chips.py:108 reads a table only "
    "note_levels.ensure_schema creates. Remove this marker when the route answers {}."))
def test_D1_thesis_chips_answer_before_the_level_table_exists(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("NOTEBOOK_THESIS_CHIPS_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    try:
        auth_db.init_db()
        from api.middleware import auth_middleware as authmw
        from api.routers import notebook_thesis_chips
        from api.services.journal_two.db import ensure_schema
        c = auth_db.get_connection()
        ensure_schema(c)
        c.close()
        app = FastAPI()
        app.include_router(notebook_thesis_chips.router)
        user = {"id": "d1-member", "role": "member", "plan": "pro"}
        app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
        app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
        res = TestClient(app, raise_server_exceptions=False).post("/api/j2/thesis-chips", json={"symbols": ["NVDA"]})
        assert res.status_code == 200 and res.json() == {}, (res.status_code, res.text[:200])
    finally:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(tmp.name + suffix)
            except OSError:
                pass


# ── D5: a second defect this work found, kept visible ───────────────────────────────────────────

@pytest.mark.xfail(strict=True, reason=(
    "DEFECT D5 (docs/notebook/fin-tests.md): a stored-bar hole in the MIDDLE of a passed setup's "
    "window shifts every later horizon by a session, unlabelled. passed_setups.score() "
    "(api/services/journal_two/passed_setups.py:221-246) reads forward[h-1] off the name's own "
    "bars and only labels a gap when the name has FEWER than h bars. Remove this marker when the "
    "+5 day cell reads the fifth session (2.5%) or is labelled missing."))
def test_D5_a_missing_session_in_the_middle_never_shifts_a_horizon():
    """The fixture name PSGP closes at 200 on the reference day and one point higher each
    session; the store is missing the fifth session after it. The market's fifth session is
    therefore a hole. The honest answers are 2.5% (the fifth session) or a labelled gap. The
    server answers 3.0%: the SIXTH session, shown under "+5 days"."""
    item = json.loads(gen.committed()["passed-setups.add.gap"])["body"]["item"]
    r5 = next(o for o in item["outcomes"] if o["key"] == "r5")
    assert item["baseClose"] == 200.0
    assert r5["missing"] is not None or r5["pct"] == 2.5, r5
