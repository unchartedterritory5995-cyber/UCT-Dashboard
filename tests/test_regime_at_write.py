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


def _stamp_regimes(note):
    """The regime value of EVERY marketcontext stamp in the body, in document order."""
    out, stack = [], list((note["bodyJson"] or {}).get("content") or [])
    while stack:
        n = stack.pop(0)
        if isinstance(n, dict) and n.get("type") == "widgetEmbed" and n["attrs"].get("widgetId") == "marketcontext":
            out.append((((n["attrs"].get("params") or {}).get("readings") or {}).get("regime") or {}).get("value"))
        elif isinstance(n, dict) and isinstance(n.get("content"), list):
            stack[0:0] = n["content"]
    return out


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

    def always(block, ctx):
        # The SAME ctx compose reads (so the builder's record lands where compose looks), with its
        # mode forced to create for this one call.
        was, ctx["mode"] = ctx["mode"], "create"
        try:
            return tb.build_market_context(block, ctx)
        finally:
            ctx["mode"] = was

    monkeypatch.setitem(js.BLOCK_BUILDERS, "marketcontext", always)
    out = js.compose("u1", s, ticker=None, conn=None, mode="update")
    assert _stamp({"bodyJson": out["bodyJson"]})["params"]["readings"]["regime"]["value"] == "red"   # control
    assert REGIME not in out["properties"]


# ── I-1 (R-T4-1): only the stamp the composer BUILT this call counts, never one in the outline ──

def _forged(value="green", as_of="2020-01-01"):
    """A marketcontext stamp as a member could paste into a style outline or a template body."""
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "marketcontext", "embedId": "forged0001", "mode": "snapshot",
        "params": {"readings": {"regime": {"value": value, "source": "UCT Exposure Rating", "asOf": as_of,
                                           "missing": None}}, "fields": "all"},
        "capturedAt": f"{as_of}T14:00:00Z", "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None}}


def _outline(*first):
    return {"type": "doc", "content": [*first,
                                       {"type": "heading", "attrs": {"level": 2},
                                        "content": [{"type": "text", "text": "The thesis"}]},
                                       {"type": "paragraph", "content": [{"type": "text", "text": "Why?"}]}]}


def _outline_style(blocks, outline, name="Forged"):
    from api.services.journal_two import journal_styles as js
    return js.create_style("u1", {"name": name, "kindId": "thesis", "blocks": blocks, "outlineBodyJson": outline})


_CTX_BLOCK = [{"block": "marketcontext", "enabled": True, "settings": {}}]


def test_a_forged_stamp_in_the_outline_with_no_context_block_stores_nothing(db_path, red):
    from api.services.journal_two import journal_styles as js
    s = _outline_style([], _outline(_forged()))
    n, _ = js.create_styled_note("u1", {"styleId": s["id"]})
    assert _stamp(n)["params"]["readings"]["regime"]["value"] == "green"           # control: forgery landed
    assert REGIME not in (n["propertiesJson"] or {})


@pytest.mark.parametrize("held, want", [("red", "red"), (None, None)])
def test_a_forged_stamp_ahead_of_the_built_one_never_wins(db_path, regime, held, want):
    """The forged GREEN stamp is FIRST in the body; the property is the held RED the builder froze,
    and nothing at all when nothing is held."""
    from api.services.journal_two import journal_styles as js
    if held is None:
        regime["regime"] = {"missing": "wire_unavailable"}
    s = _outline_style(_CTX_BLOCK, _outline(_forged()))
    n, _ = js.create_styled_note("u1", {"styleId": s["id"]})
    assert _stamp(n)["params"]["readings"]["regime"]["value"] == "green"           # control: forged is first
    assert (n["propertiesJson"] or {}).get(REGIME) == want


def test_a_forged_stamp_ahead_of_the_built_one_never_wins_through_inserts_outline(db_path, red):
    from api.services.journal_two import journal_styles as js, notes
    s = _outline_style(_CTX_BLOCK, _outline(_forged()))
    empty = notes.create_note("u1", {"title": "empty"})
    note, plan = js.apply_style_update("u1", empty["id"], style_id=s["id"])
    assert plan["insertsOutline"]
    assert _stamp(note)["params"]["readings"]["regime"]["value"] == "green"        # control
    assert note["propertiesJson"][REGIME] == "red"


@pytest.mark.parametrize("with_block, want", [(False, None), (True, "amber")])
def test_a_template_saved_from_an_old_note_never_copies_its_regime(db_path, regime, with_block, want):
    """A note written in RED is saved as a template; a style links it. Today reads YELLOW. A note
    made from that style records today's regime (only if it builds a context block), never RED."""
    from api.services.journal_two import journal_styles as js, note_templates
    old = _styled_note()
    assert old["propertiesJson"][REGIME] == "red"
    tpl = note_templates.create_from_note("u1", old["id"], name="Old thesis")
    regime["regime"] = {**regime["regime"], "value": "amber", "asOf": "2026-10-20"}
    s = js.create_style("u1", {"name": "From template", "kindId": "thesis", "outlineTemplateId": tpl["id"],
                              "blocks": _CTX_BLOCK if with_block else []})
    n, _ = js.create_styled_note("u1", {"styleId": s["id"]})
    assert "red" in _stamp_regimes(n)                                              # control: old stamp copied
    assert (n["propertiesJson"] or {}).get(REGIME) == want


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


# ── S1 / M-1, in code: only notes.py and the composer ever pass a captured mode, in ANY form ────

ROOT = Path(__file__).resolve().parents[1]
_KEYWORDS = ("captured", "captured_properties")
_WRITERS = ("create_note", "update_note", "set_note_properties")
_ALLOWED = {"api/services/journal_two/notes.py", "api/services/journal_two/journal_styles.py"}


def _max_positional() -> dict[str, int]:
    """How many arguments each writer accepts POSITIONALLY, from its real signature (never typed)."""
    import inspect
    from api.services.journal_two import note_properties, notes
    fns = {"create_note": notes.create_note, "update_note": notes.update_note,
           "set_note_properties": note_properties.set_note_properties}
    kinds = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    return {name: sum(1 for p in inspect.signature(fn).parameters.values() if p.kind in kinds)
            for name, fn in fns.items()}


def _callee(node: ast.Call) -> str | None:
    f = node.func
    return f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else None)


def _sites(source: str, path: str, max_pos: dict[str, int]) -> list[tuple[str, int, str]]:
    """Every way a call could hand a writer a captured mode, from the AST (a comment or a docstring
    never counts): a `captured`/`captured_properties` keyword with ANY value, a `**` splat into a
    writer, and a writer called with more positionals than it takes (or a `*` splat)."""
    out = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        name = _callee(node)
        for kw in node.keywords:
            if kw.arg in _KEYWORDS:
                val = kw.value.value if isinstance(kw.value, ast.Constant) else "<expr>"
                out.append((path, node.lineno, f"keyword {kw.arg}={val}"))
            elif kw.arg is None and name in _WRITERS:
                out.append((path, node.lineno, f"** splat into {name}"))
        if name in _WRITERS and (len(node.args) > max_pos[name]
                                 or any(isinstance(a, ast.Starred) for a in node.args)):
            out.append((path, node.lineno, f"positional into {name}"))
    return out


def _all_sites() -> list[tuple[str, int, str]]:
    max_pos = _max_positional()
    out = []
    for p in sorted((ROOT / "api").rglob("*.py")):
        if "__pycache__" in p.parts or p.name.startswith("test_"):
            continue
        out.extend(_sites(p.read_text(encoding="utf-8"), p.relative_to(ROOT).as_posix(), max_pos))
    return out


def test_the_rail_sees_every_form_and_not_a_comment():
    """Controls, one per shape: each real form is found; the same text in prose is not."""
    mp = _max_positional()
    assert mp["update_note"] >= 3                                                   # non-vacuity
    over = ", ".join(f"a{i}" for i in range(mp["update_note"] + 1))
    found = {
        "literal": "f(x, captured_properties='keep')",
        "expression": "svc.create_note(u, p, captured_properties=payload.get('m'))",
        "short name": "set_note_properties(u, n, p, c, captured=mode)",
        "splat": "notes_service.update_note(u, n, p, **extra)",
        "positional": f"update_note({over})",
        "star": "create_note(*args)",
    }
    for shape, src in found.items():
        assert _sites(src, "r", mp), shape
    quiet = {
        "comment": "# f(x, captured_properties='keep')" + chr(10) + "x = 1",
        "docstring": '"""update_note(u, n, p, **extra) captured=keep"""',
        "splat into another function": "other(u, **extra)",
        "a writer within its positional limit": "update_note(u, n, p)",
    }
    for shape, src in quiet.items():
        assert _sites(src, "q", mp) == [], shape


def test_the_captured_mode_is_keyword_only():
    import inspect
    from api.services.journal_two import note_properties, notes
    kw = inspect.Parameter.KEYWORD_ONLY
    assert inspect.signature(notes.create_note).parameters["captured_properties"].kind == kw
    assert inspect.signature(notes.update_note).parameters["captured_properties"].kind == kw
    assert inspect.signature(note_properties.set_note_properties).parameters["captured"].kind == kw


def test_only_notes_and_the_composer_pass_a_captured_mode():
    sites = _all_sites()
    assert any(p.endswith("journal_styles.py") and "=keep" in w for p, _, w in sites), (
        "non-vacuity: the composer's keep site must be found")
    outside = [s for s in sites if s[0] not in _ALLOWED]
    assert not outside, outside
    # notes.py threads the mode through (a variable), and never hard-codes keep.
    assert not [s for s in sites if s[0].endswith("journal_two/notes.py") and "=keep" in s[2]], sites


# ── M-4: the filter's refusal names a captured property for what it is ─────────────────────────

def test_the_filter_refusal_says_captured_not_derived(db_path):
    from api.services.journal_two import note_properties as np
    from api.services.journal_two.notes import list_notes
    with pytest.raises(np.PropertyValidationError) as got:
        list_notes("u1", property_filter=[{"propertyId": REGIME, "op": "eq", "value": "red"}])
    assert "recorded when a note is written" in str(got.value), str(got.value)
    assert "derived" not in str(got.value)
    with pytest.raises(np.PropertyValidationError) as derived:                    # control: unchanged
        list_notes("u1", property_filter=[{"propertyId": "builtin:ticker", "op": "eq", "value": "NVDA"}])
    assert "derived" in str(derived.value)
