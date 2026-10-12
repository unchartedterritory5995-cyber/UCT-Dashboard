"""R-P2-6 / IR-S1: builtin:regime_at_write is written once by the composer, never by a member (in
either property form), and a restore neither changes nor clears it.

Integrator rulings carried here: S1 (a member PUT cannot set it; create does), R-RC-1 (capture on a
real create and on insertsOutline only; never on Update layout or a restore), R-W0-1 / R-T3-1 (the
value is read from HELD state only: it is the market context stamp's own regime reading, which
trader_blocks reads held-only), R-W0-2 (the value's date is the regime's own date, the stamp's
`readings.regime.asOf`, dated as entry_context._regime_fields dates it; an undated regime is not
captured)."""
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

REGIME = "builtin:regime_at_write"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def regime(monkeypatch):
    """Every market source patched at trader_blocks' seams (hermetic). Tests change the dict."""
    from api.services.journal_two import trader_blocks as tb
    s = {"regime": {"value": "red", "source": "UCT Exposure Rating", "asOf": "2026-10-13",
                    "missing": None, "detail": None}}
    monkeypatch.setattr(tb, "_breadth", lambda: {})
    monkeypatch.setattr(tb, "_regime_field", lambda memo: s["regime"])
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols, now=None: {})
    return s


@pytest.fixture
def red(regime):
    return regime


def _ctx_style(user="u1", name="Ctx", blocks=None):
    from api.services.journal_two import journal_styles as js
    return js.create_style(user, {"name": name, "kindId": "thesis",
                                  "blocks": blocks or [{"block": "marketcontext", "enabled": True,
                                                        "settings": {}}]})


def _styled_note(user="u1"):
    from api.services.journal_two import journal_styles as js
    s = _ctx_style(user)
    n, _ = js.create_styled_note(user, {"styleId": s["id"]})
    return n


def _stamp(note):
    stack = list((note["bodyJson"] or {}).get("content") or [])
    while stack:
        n = stack.pop(0)
        if isinstance(n, dict) and n.get("type") == "widgetEmbed" and n["attrs"].get("widgetId") == "marketcontext":
            return n["attrs"]
        if isinstance(n, dict) and isinstance(n.get("content"), list):
            stack[0:0] = n["content"]
    return None


def _put(note_id, body):
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1"}
    return TestClient(app).put(f"/api/j2/notes/{note_id}", json=body)


# ── the brief's tests ──────────────────────────────────────────────────────────────────────────

def test_a_styled_note_records_the_regime_it_was_written_in(db_path, red):
    n = _styled_note()
    assert n["propertiesJson"][REGIME] == "red"


def test_no_context_block_no_property(db_path, red):
    from api.services.journal_two import journal_styles as js
    n, _ = js.create_styled_note("u1", {"styleId": "builtin:weekly_review"})
    assert REGIME not in (n["propertiesJson"] or {})


def test_a_member_put_cannot_set_or_clear_it(db_path, red):
    """IR-S1: through the member's own PUT route, in BOTH forms. Filtered before the write: 200, unchanged."""
    from api.services.journal_two import notes
    n = _styled_note()
    for body in ({"properties": {REGIME: "green"}},
                 {"propertiesReplace": {REGIME: "green"}},
                 {"propertiesReplace": {}},
                 {"properties": {REGIME: None}}):
        got = _put(n["id"], body)
        assert got.status_code == 200, (body, got.text)
        assert notes.get_note("u1", n["id"])["propertiesJson"].get(REGIME) == "red", body
    plain = notes.create_note("u1", {"title": "plain"})
    assert _put(plain["id"], {"properties": {REGIME: "green"}}).status_code == 200
    assert REGIME not in (notes.get_note("u1", plain["id"])["propertiesJson"] or {})


def test_a_member_cannot_set_a_derived_builtin_either(db_path):
    """IR-S2: the refusal a member sees for a non-settable built-in is notes.NoteValidationError (400)."""
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"})
    with pytest.raises(notes.NoteValidationError):
        notes.update_note("u1", n["id"], {"properties": {"builtin:ticker": "NVDA"}}, client_schema=4)


def test_a_plain_create_drops_it(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"}, properties={REGIME: "green", "builtin:confidence": "high"})
    assert n["propertiesJson"] == {"builtin:confidence": "high"}


def test_a_version_restore_keeps_the_captured_regime_and_captures_nothing(db_path, red, monkeypatch):
    from api.services.journal_two import notes, trader_blocks as tb
    n = _styled_note()
    n2 = notes.update_note("u1", n["id"], {"title": "edited"}, client_schema=4, force_version=True)
    oldest = notes.list_note_versions("u1", n["id"])[-1]
    monkeypatch.setattr(tb, "market_context_params", lambda *a, **k: pytest.fail("a restore must not capture"))
    restored = notes.restore_note_version("u1", n["id"], oldest["id"], expected_updated_at=n2["updatedAt"])
    assert restored["propertiesJson"][REGIME] == "red"


def test_the_def_is_listed_and_read_only():
    from api.services.journal_two import note_properties as np
    d = np._BUILTIN_BY_ID[REGIME]
    assert d["source"] == "captured" and d["type"] == "select"
    assert [o["id"] for o in d["options"]] == ["green", "amber", "orange", "red"]
    assert REGIME not in np.BUILTIN_USER_SET_IDS
    assert np.BUILTIN_CAPTURED_IDS == frozenset({REGIME})
    assert np.REGIME_AT_WRITE == REGIME


def test_the_options_are_the_regime_ids_the_stamp_reads():
    """ONE fact: the def's option ids are exactly the ids trader_blocks' regime reading answers."""
    from api.services.journal_two import note_properties as np, trader_blocks as tb
    assert tuple(o["id"] for o in np._BUILTIN_BY_ID[REGIME]["options"]) == tb.REGIME_IDS


# ── R-RC-1: create and insertsOutline capture; Update layout and restore never do ──────────────

def test_an_empty_note_switched_to_a_style_captures_it(db_path, red):
    """insertsOutline is create-equivalent: the outline is composed fresh, the stamp captures, and
    the property is written in the same compare-and-set."""
    from api.services.journal_two import journal_styles as js, notes
    s = _ctx_style()
    empty = notes.create_note("u1", {"title": "empty"})
    plan = js.plan_style_update("u1", empty["id"], style_id=s["id"])
    assert plan["insertsOutline"] and plan["mode"] == "create"
    note, _ = js.apply_style_update("u1", empty["id"], style_id=s["id"])
    assert note["propertiesJson"][REGIME] == "red"
    assert _stamp(note)["params"]["readings"]["regime"]["value"] == "red"


def test_update_layout_on_a_written_note_never_stamps_todays_regime(db_path, red):
    """A note with words switched to a context style gets the block UNCAPTURED, and no regime."""
    from api.services.journal_two import journal_styles as js, notes
    s = _ctx_style()
    written = notes.create_note("u1", {"title": "old", "bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "words from last week"}]}]}})
    note, plan = js.apply_style_update("u1", written["id"], style_id=s["id"])
    assert plan["mode"] == "update" and plan["switching"]
    assert _stamp(note)["params"].get("uncaptured") is True                      # the block did land
    assert REGIME not in (note["propertiesJson"] or {})


def test_update_layout_never_changes_a_captured_regime(db_path, regime):
    """The note was written in RED; today reads GREEN. Updating its layout keeps RED."""
    from api.services.journal_two import journal_styles as js
    n = _styled_note()
    regime["regime"] = {**regime["regime"], "value": "green", "asOf": "2026-10-20"}
    other = _ctx_style(name="Ctx and chart", blocks=[
        {"block": "marketcontext", "enabled": True, "settings": {}},
        {"block": "chart", "enabled": True, "settings": {"tf": "D"}}])
    note, plan = js.apply_style_update("u1", n["id"], style_id=other["id"])
    assert plan["mode"] == "update"
    assert note["propertiesJson"][REGIME] == "red"


def test_compose_in_update_mode_never_carries_it(db_path, red):
    from api.services.journal_two import journal_styles as js
    s = _ctx_style()
    assert REGIME in js.compose("u1", s, ticker=None, conn=None, mode="create")["properties"]
    assert REGIME not in js.compose("u1", s, ticker=None, conn=None, mode="update")["properties"]


def test_the_create_mode_guard_holds_even_if_a_stamp_were_captured_in_update(db_path, red, monkeypatch):
    """compose's own `mode == "create"` guard, proved apart from the builder: a marketcontext builder
    that (wrongly) captured in update mode still cannot put today's regime on an older note."""
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    s = _ctx_style()
    always = lambda block, ctx: tb.build_market_context(block, {**ctx, "mode": "create"})   # noqa: E731
    monkeypatch.setitem(js.BLOCK_BUILDERS, "marketcontext", always)
    out = js.compose("u1", s, ticker=None, conn=None, mode="update")
    assert _stamp({"bodyJson": out["bodyJson"]})["params"]["readings"]["regime"]["value"] == "red"   # control
    assert REGIME not in out["properties"]


# ── R-W0-2: the date is the regime's own; no date, no value ────────────────────────────────────

def test_the_value_is_the_stamps_regime_dated_by_the_regime_not_the_capture(db_path, regime):
    """The property's value is the stamp's regime reading, whose asOf is the regime's own date (the
    wire run's), not the capture time: here the wire is three days older than the note."""
    regime["regime"] = {**regime["regime"], "value": "amber", "asOf": "2026-10-09"}
    n = _styled_note()
    attrs = _stamp(n)
    assert n["propertiesJson"][REGIME] == "amber"
    assert attrs["params"]["readings"]["regime"]["asOf"] == "2026-10-09"
    assert not attrs["capturedAt"].startswith("2026-10-09")                      # capture is today


@pytest.mark.parametrize("field", [
    {"missing": "wire_unavailable"},                                             # nothing held
    {"missing": "source_error"},                                                 # unreadable
    {"value": "red", "source": "UCT Exposure Rating", "asOf": None, "missing": None},   # undated
    {"value": "purple", "source": "UCT Exposure Rating", "asOf": "2026-10-13", "missing": None},
])
def test_no_held_dated_regime_no_property(db_path, regime, field):
    """Never a fabricated value: an unheld, unreadable, undated or unknown regime stores nothing."""
    regime["regime"] = field
    n = _styled_note()
    assert _stamp(n) is not None                                                 # the stamp still lands
    assert REGIME not in (n["propertiesJson"] or {})


def test_a_create_reads_the_regime_from_held_state_only(db_path, monkeypatch):
    """R-W0-1: the REAL trader_blocks seams on a cold pod. engine.get_breadth is asked only
    held_only=True (never the live fetch), and the property is absent rather than invented."""
    from api.services import engine
    from api.services.journal_two import trader_blocks as tb
    asked = []

    def fake_get_breadth(held_only=False):
        asked.append(held_only)
        return None

    monkeypatch.setattr(engine, "get_breadth", fake_get_breadth)
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols, now=None: {})
    n = _styled_note()
    assert asked and all(asked), asked                                           # non-vacuity + held-only
    assert REGIME not in (n["propertiesJson"] or {})


# ── S1, in code: only the composer passes the keep mode, and no route passes either keyword ────

_KEYWORDS = ("captured", "captured_properties")


def _keep_sites(source: str, path: str) -> list[tuple[str, int, str]]:
    """Every Call that passes `captured`/`captured_properties` as a keyword, from the AST (so a
    comment or a docstring never counts): (path, line, the constant passed, or '<expr>')."""
    out = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                if kw.arg in _KEYWORDS:
                    val = kw.value.value if isinstance(kw.value, ast.Constant) else "<expr>"
                    out.append((path, node.lineno, val))
    return out


def _all_sites() -> list[tuple[str, int, str]]:
    out = []
    for p in sorted(Path("api").rglob("*.py")):
        if "__pycache__" in p.parts or p.name.startswith("test_"):
            continue
        out.extend(_keep_sites(p.read_text(encoding="utf-8"), p.as_posix()))
    return out


def test_the_rail_sees_a_call_and_not_a_comment():
    """Controls: a real call is found; the same text in a comment or a docstring is not."""
    real = "f(x, captured_properties='keep')\n"
    comment = "# f(x, captured_properties='keep')\nx = 1\n"
    doc = '"""f(x, captured_properties=\'keep\')"""\n'
    assert _keep_sites(real, "r") == [("r", 1, "keep")]
    assert _keep_sites(comment, "c") == []
    assert _keep_sites(doc, "d") == []


def test_only_the_composer_writes_a_captured_property():
    sites = _all_sites()
    keep = [(p, v) for p, _, v in sites if v == "keep"]
    assert keep, "non-vacuity: the composer's keep sites must be found"
    assert {p for p, _ in keep} == {"api/services/journal_two/journal_styles.py"}, keep
    assert not [s for s in sites if s[0].startswith("api/routers/")], sites
    # notes.py threads the mode through (a variable), and never hard-codes keep.
    assert all(v != "keep" for p, _, v in sites if p.endswith("journal_two/notes.py")), sites
