"""Notebook widgets phase 2, wave 11, Task 11.5: built-widget template slots.

"Save as template" turns each placed `builtWidget` into a `built_<k>` slot pinned to its revision; making a
note from the template runs the pinned plan through the wave 8 engine for the session member and places the
node the client's insert makes. Ownership is checked at FILL time (`WHERE id = ? AND user_id = ?`): a ref
that does not resolve is one sentence, never a read of another member's row (W9-R18). Plus the carried
rulings: W11-R21 (display names), 11.3 re-review m-1..m-4."""
from __future__ import annotations

import importlib
import json
import os
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)
A, B = "u-slot-a", "u-slot-b"
SHELF = "shelf:equity-curve"            # r1 needs no dark wave, r2 needs wave 10
VECTORS = Path("tests/fixtures/builtRefreshParamsVectors.json")
ALL_ON = (1, 2, 3, 4, 5, 6, 8, 9, 10, 11)


@pytest.fixture
def db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw
    from api.services.journal_two.widget_engine import run
    monkeypatch.setattr(js, "_SLOT_POOL", nw.BoundedPool(js.SLOT_POOL_WORKERS, "nb-style-slot-test"))
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-widget-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    _waves(monkeypatch, *ALL_ON)
    yield tmp.name
    run._reset_state()
    os.unlink(tmp.name)


def _waves(monkeypatch, *on):
    for w in range(1, 13):
        if w in on:
            monkeypatch.setenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", "1")
        else:
            monkeypatch.delenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", raising=False)


def _base_plan(token="last_90d", **over):
    from api.services.journal_two.widget_engine import shelf
    p = json.loads(json.dumps(shelf.revision(SHELF, 1)["plan"]))
    p["range"] = {"token": token}
    p["display"]["title"] = over.pop("title", "My curve")
    p.update(over)
    return p


def _def(uid=A, name="My curve", plan=None, now=NOW):
    from api.services.journal_two import widget_definitions as wd
    return wd.create(uid, name, plan or _base_plan(), now=now)


def _text(node):
    return "".join(c.get("text", "") for c in node.get("content") or [])


def _lines(body):
    return [_text(n) for n in body["content"] if n.get("type") == "paragraph"]


def _built_nodes(body):
    out, stack = [], list(body.get("content") or [])
    while stack:
        n = stack.pop(0)
        if isinstance(n, dict):
            if n.get("type") == "widgetEmbed" and (n.get("attrs") or {}).get("widgetId") == "builtWidget":
                out.append(n)
            stack.extend(n.get("content") or [])
    return out


def _style(*blocks, outline=None):
    """A style dict as compose reads it (blocks placed after the first heading unless the outline says)."""
    return {"id": "s-test", "kindId": "trade_plan", "version": 1, "properties": {}, "builtin": False,
            "blocks": [{"block": bid, "enabled": True, "settings": s} for bid, s in blocks],
            "outlineBodyJson": outline or {"type": "doc", "content": [
                {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Prep"}]}]}}


def _fake_payload(def_id=None, def_rev=None, plan=None):
    return {"asOf": "2026-10-24T15:30:00Z", "source": None, "sourceKey": "closed_trades", "view": "line",
            "title": "x", "defId": def_id, "defRev": def_rev, "latestRev": None, "def": plan, "count": 0}


class _RunSpy:
    def __init__(self, monkeypatch, fail=None, delay=None):
        from api.services.journal_two.widget_engine import run
        self.calls, self.fail, self.delay = [], fail, delay
        monkeypatch.setattr(run, "run_plan", self)

    def __call__(self, user_id, plan, settings, *, lane, def_id=None, def_rev=None, latest_rev=None,
                 now=None, sample=False):
        self.calls.append({"user_id": user_id, "plan": plan, "settings": settings, "lane": lane,
                           "def_id": def_id, "def_rev": def_rev, "latest_rev": latest_rev})
        if self.delay is not None:
            self.delay.wait(10)
        if self.fail is not None:
            raise self.fail
        return _fake_payload(def_id, def_rev, plan)


class _DefsSpy:
    """Every call slot_fill makes into widget_definitions, with the user id it asked as."""
    def __init__(self, monkeypatch):
        from api.services.journal_two import widget_definitions as wd
        self.users = []
        for name in ("resolve_for_run", "get", "resolve_many"):
            real = getattr(wd, name)

            def wrap(uid, *a, _real=real, _name=name, **k):
                self.users.append((_name, uid))
                return _real(uid, *a, **k)
            monkeypatch.setattr(wd, name, wrap)


def _embed(params):
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "builtWidget", "embedId": "e" + str(abs(hash(json.dumps(params, sort_keys=True)))),
        "mode": "snapshot", "params": params, "capturedAt": "2026-10-20T14:30:00Z", "annotations": [],
        "caption": None, "layout": {"width": "full", "height": None}, "fallback": None}}


# ── save as template ────────────────────────────────────────────────────────────────────────────

def test_save_as_template_turns_built_widgets_into_slots_in_place(db):
    from api.services.journal_two import journal_styles as js, notes as notes_service
    d = _def()
    para = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
    body = {"type": "doc", "content": [
        js._h("Prep"), para("before"),
        _embed({"defId": SHELF, "defRev": 1, "range": {"token": "last_30d"}, "accountId": "acc-1",
                "filter": ["Breakout"], "count": 4, "rows": [{"v1": 987.5}]}),
        para("between"),
        _embed({"defId": d["id"], "defRev": 3, "range": {"from": "2026-01-01", "to": "2026-02-01"},
                "accountId": "acc-2", "filter": {"values": ["x"]}}),
        {"type": "blockquote", "content": [_embed({"defId": SHELF})]},          # nested: no placeholder
        _embed({"asOf": "x"}),                                                  # names no widget
        para("after")]}
    note = notes_service.create_note(A, {"title": "N", "bodyJson": body})
    left = []
    s = js.create_style_from_note(A, note["id"], "Mine", "trade_plan", left_out=left)
    full = js.get_style(A, s["id"], full=True)
    assert full["blocks"] == [
        {"block": "built_a", "enabled": True, "settings": {"ref": SHELF, "defRev": 1, "range": {"token": "last_30d"}}},
        {"block": "built_b", "enabled": True, "settings": {"ref": f"def:{d['id']}", "defRev": 3}},
        {"block": "built_c", "enabled": True, "settings": {"ref": SHELF, "defRev": 1}}]
    assert left == [{"widgetId": "builtWidget", "reason": "not-a-style-block"}]
    texts = [_text(n) for n in full["outlineBodyJson"]["content"]]
    assert texts[:6] == ["Prep", "before", "{{block:built_a}}", "between", "{{block:built_b}}", ""]
    stored = json.dumps(full["blocks"])
    for gone in ("acc-1", "acc-2", "Breakout", "987.5", "filter", "accountId"):
        assert gone not in stored, gone                     # the member's viewer values never reach a template


def test_save_as_template_leaves_built_widgets_out_while_wave_11_is_off(db, monkeypatch):
    from api.services.journal_two import journal_styles as js, notes as notes_service
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    body = {"type": "doc", "content": [js._h("Prep"), _embed({"defId": SHELF, "defRev": 1})]}
    note = notes_service.create_note(A, {"title": "N", "bodyJson": body})
    left = []
    s = js.create_style_from_note(A, note["id"], "Mine", "trade_plan", left_out=left)
    assert s["blocks"] == [] and left == [{"widgetId": "builtWidget", "reason": "not-a-style-block"}]


def test_slot_keys_run_a_to_z_then_a1():
    from api.services.journal_two import journal_styles as js
    keys = [js.slot_key(i) for i in range(60)]
    assert keys[:3] == ["a", "b", "c"] and keys[25] == "z" and keys[26:28] == ["a1", "b1"] and keys[52] == "a2"
    assert len(set(keys)) == 60 and all(js.slot_family(f"built_{k}") == "built" for k in keys)


# ── fill ────────────────────────────────────────────────────────────────────────────────────────

def test_fill_runs_the_pinned_revision(db, monkeypatch):
    from api.services.journal_two import journal_styles as js, widget_definitions as wd
    d = _def(plan=_base_plan("last_7d"))
    for i, token in enumerate(("last_30d", "last_90d"), start=1):                    # revisions 2 and 3
        d = wd.update(A, d["id"], if_match=d["etag"], plan=_base_plan(token), apply="only",
                      now=NOW + timedelta(minutes=5 * i))
    assert d["rev"] == 3
    s = js.create_style(A, {"name": "T", "kindId": "trade_plan",
                            "blocks": [{"block": "built_a", "settings": {"ref": f"def:{d['id']}", "defRev": 3}}]})
    d = wd.update(A, d["id"], if_match=d["etag"], plan=_base_plan("ytd"), apply="only", now=NOW + timedelta(hours=1))
    assert d["rev"] == 4                                                             # saved after the template
    spy = _RunSpy(monkeypatch)
    out = js.compose(A, js.get_style(A, s["id"]), ticker=None, conn=None, now=NOW)
    assert len(spy.calls) == 1
    call = spy.calls[0]
    assert call["plan"]["range"] == {"token": "last_90d"}                            # revision 3, not 4
    assert (call["def_id"], call["def_rev"], call["latest_rev"], call["lane"], call["user_id"]) == (
        d["id"], 3, 4, "run", A)
    assert len(_built_nodes(out["bodyJson"])) == 1


def test_fill_node_shape_matches_the_client_insert(db, monkeypatch):
    """The node is the client's insert: `params == builtRefreshParams({}, payload)`, the rule both sides read from
    one vector file; a real run (no spy) carries the frozen `def` at most 4 KB, else `defRef`."""
    from api.services.journal_two import journal_styles as js, slot_fill
    from api.services.journal_two.widget_engine import payload as wpayload
    vectors = json.loads(VECTORS.read_text(encoding="utf-8"))
    assert vectors["version"] == 2 and len(vectors["cases"]) >= 8
    assert [list(f) for f in slot_fill.BUILT_PARAM_FIELDS] == vectors["fields"]
    for c in vectors["cases"]:
        refreshed = slot_fill.refresh_params(c["old"], c["payload"])
        assert refreshed == c["expected"], c["name"]
        params = slot_fill.normalize_params(refreshed)
        assert params == c["params"], c["name"]
        assert slot_fill.search_text(params) == c["searchText"], c["name"]
    d = _def()
    style = _style(("built_a", {"ref": SHELF, "defRev": 1, "range": {"token": "last_30d"}}),
                   ("built_b", {"ref": f"def:{d['id']}", "defRev": 1}))
    out = js.compose(A, style, ticker=None, conn=None, now=NOW)
    nodes = _built_nodes(out["bodyJson"])
    assert len(nodes) == 2 and out["skipped"] == []
    shelf_node, def_node = nodes
    for n in nodes:
        a = n["attrs"]
        assert set(a) == {"v", "widgetId", "embedId", "mode", "params", "capturedAt", "annotations", "caption",
                          "layout", "fallback", "tradeRef", "tradeRefType", "searchText"}
        assert (a["tradeRef"], a["tradeRefType"]) == (None, None)
        assert a["searchText"] == slot_fill.search_text(a["params"]) and a["searchText"].startswith("[widget: ")
        assert (a["v"], a["widgetId"], a["mode"], a["annotations"], a["caption"], a["fallback"]) == (
            1, "builtWidget", "snapshot", [], None, None)
        assert a["layout"] == {"width": "full", "height": None}
        assert a["capturedAt"] == a["params"]["asOf"] and a["params"]["share"] is False
        assert a["params"] == slot_fill.normalize_params(a["params"])               # already the insert's shape
        assert None not in a["params"].values()                                     # nulls dropped, as the client
    assert shelf_node["attrs"]["embedId"] != def_node["attrs"]["embedId"]
    sp, dp = shelf_node["attrs"]["params"], def_node["attrs"]["params"]
    assert (sp["defId"], sp["defRev"], sp["range"]) == (SHELF, 1, {"token": "last_30d"})
    assert (dp["defId"], dp["defRev"]) == (d["id"], 1)
    assert isinstance(dp["def"], dict) and "defRef" not in dp and "accountId" not in dp
    # over 4 KB the frozen plan is a reference (a fresh engine cache: the first run's payload is cached)
    from api.services.journal_two.widget_engine import run
    run._reset_state()
    monkeypatch.setattr(wpayload, "DEF_MAX_BYTES", 10)
    big = _built_nodes(js.compose(A, _style(("built_a", {"ref": f"def:{d['id']}", "defRev": 1})), ticker=None,
                                  conn=None, now=NOW + timedelta(minutes=1))["bodyJson"])[0]["attrs"]["params"]
    assert "def" not in big and big["defRef"] == {"id": d["id"], "rev": 1}


def test_foreign_def_ref_is_a_sentence_and_reads_nothing_foreign(db, monkeypatch):
    from api.services.journal_two import journal_styles as js
    theirs = _def(uid=B, name="Their secret widget")
    spy, defs = _RunSpy(monkeypatch), _DefsSpy(monkeypatch)
    s = js.create_style(A, {"name": "T", "kindId": "trade_plan", "blocks": [
        {"block": "built_a", "settings": {"ref": f"def:{theirs['id']}", "defRev": 1}}]})
    out = js.compose(A, js.get_style(A, s["id"]), ticker=None, conn=None, now=NOW)
    assert "This widget is not in your account." in _lines(out["bodyJson"])
    assert out["skipped"] == [{"block": "built_a", "reason": "slot-missing:built_a"}]
    assert out["slotNames"] == {"built_a": "This widget is not in your account."}
    assert spy.calls == [] and _built_nodes(out["bodyJson"]) == []
    assert defs.users and {u for _, u in defs.users} == {A}                      # never asked as member B
    assert "Their secret widget" not in json.dumps(out)
    served = js.served_style(js.get_style(A, s["id"]), A)
    assert served["slotNames"] == {"built_a": "This widget is not in your account."}


def test_deleted_def_31_days_is_a_sentence(db, monkeypatch):
    from api.services.journal_two import journal_styles as js, widget_definitions as wd
    gone = datetime.now(timezone.utc) - timedelta(days=31)
    d = _def(now=gone)
    wd.archive(A, d["id"], now=gone)
    wd.soft_delete(A, d["id"], typed_name="My curve", now=gone)
    spy = _RunSpy(monkeypatch)
    out = js.compose(A, _style(("built_a", {"ref": f"def:{d['id']}", "defRev": 1})), ticker=None, conn=None, now=NOW)
    assert "This widget is not in your account." in _lines(out["bodyJson"]) and spy.calls == []


def test_def_needing_wave10_while_off_is_dropped_silently(db, monkeypatch):
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two.widget_engine import plan as wplan, shelf
    w10_plan = json.loads(json.dumps(shelf.revision(SHELF, 2)["plan"]))
    assert wplan.uses_wave10(w10_plan)
    d = _def(plan=w10_plan)
    spy = _RunSpy(monkeypatch)
    style = _style(("built_a", {"ref": f"def:{d['id']}", "defRev": 1}),
                   ("built_b", {"ref": "inline:d1"}))
    defs = {"d1": {"plan": w10_plan, "name": "Shared curve"}}
    _waves(monkeypatch, *(w for w in ALL_ON if w != 10))
    out = js.compose(A, style, ticker=None, conn=None, now=NOW, definitions=defs)
    assert spy.calls == [] and _built_nodes(out["bodyJson"]) == []
    assert out["skipped"] == [] and _lines(out["bodyJson"]) == []                    # no node, no line
    _waves(monkeypatch, *ALL_ON)                                                     # control: it CAN run
    out = js.compose(A, style, ticker=None, conn=None, now=NOW, definitions=defs)
    assert len(spy.calls) == 2 and len(_built_nodes(out["bodyJson"])) == 2


def test_inline_ref_reads_ctx_definitions_only(db, monkeypatch):
    from api.services.journal_two import journal_styles as js
    plan = _base_plan("last_30d", title="Shared curve")
    spy, defs = _RunSpy(monkeypatch), _DefsSpy(monkeypatch)
    style = _style(("built_a", {"ref": "inline:d1"}))
    out = js.compose(A, style, ticker=None, conn=None, now=NOW,
                     definitions={"d1": {"plan": plan, "name": "Shared curve"}})
    assert len(spy.calls) == 1 and spy.calls[0]["plan"] == plan and spy.calls[0]["def_id"] is None
    assert defs.users == []                                                          # no stored row is read
    assert out["slotNames"] == {"built_a": "Shared curve"} and len(_built_nodes(out["bodyJson"])) == 1
    spy.calls.clear()
    out = js.compose(A, style, ticker=None, conn=None, now=NOW)                      # no definitions given
    assert spy.calls == [] and "This widget is not in your account." in _lines(out["bodyJson"])


def test_preview_reads_nothing_and_names_the_widget(db, monkeypatch):
    from api.services.journal_two import journal_styles as js
    d = _def(name="Setups this month")
    s = js.create_style(A, {"name": "T", "kindId": "trade_plan", "blocks": [
        {"block": "built_a", "settings": {"ref": SHELF, "defRev": 1}},
        {"block": "built_b", "settings": {"ref": f"def:{d['id']}", "defRev": 1}}]})
    spy, defs = _RunSpy(monkeypatch), _DefsSpy(monkeypatch)
    out = js.preview(A, {"styleId": s["id"]})
    lines = _lines(out["bodyJson"])
    assert "Equity curve fills in with your own data when you make a note." in lines
    assert "Setups this month fills in with your own data when you make a note." in lines
    assert spy.calls == [] and not [n for n, _ in defs.users if n == "resolve_for_run"]
    assert len([n for n, _ in defs.users if n == "resolve_many"]) == 1                  # one batched read
    assert out["slotNames"] == {"built_a": "Equity curve", "built_b": "Setups this month"}


def test_slot_budget_still_bounds_a_slow_built_slot(db, monkeypatch):
    from api.services.journal_two import journal_styles as js
    monkeypatch.setattr(js, "SLOT_BUDGET_S", 0.5)
    release = threading.Event()
    spy = _RunSpy(monkeypatch, delay=release)
    s = js.create_style(A, {"name": "T", "kindId": "trade_plan",
                            "blocks": [{"block": "built_a", "settings": {"ref": SHELF, "defRev": 1}}]})
    try:
        t0 = time.monotonic()
        note, skipped = js.create_styled_note(A, {"styleId": s["id"], "title": "N"})
        took = time.monotonic() - t0
    finally:
        release.set()
    assert took < 3.0 + js.SLOT_BUDGET_S, took
    assert len(spy.calls) == 1                                                       # non-vacuity: it was asked
    assert "Equity curve couldn't load. Type / to add it again." in _lines(note["bodyJson"])
    assert skipped == [{"block": "built_a", "reason": "widget-failed:built_a"}]
    assert _built_nodes(note["bodyJson"]) == []


def test_a_busy_engine_is_retried_inside_the_budget_and_a_raise_is_the_sentence(db, monkeypatch):
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two.widget_engine import run
    tries = []

    def busy_twice(user_id, plan, settings, **k):
        tries.append(1)
        if len(tries) < 3:
            raise run.EngineBusy()
        return _fake_payload(k.get("def_id"), k.get("def_rev"), plan)
    monkeypatch.setattr(run, "run_plan", busy_twice)
    style = _style(("built_a", {"ref": SHELF, "defRev": 1}))
    out = js.compose(A, style, ticker=None, conn=None, now=NOW)
    assert len(tries) == 3 and len(_built_nodes(out["bodyJson"])) == 1
    _RunSpy(monkeypatch, fail=RuntimeError("db gone"))
    out = js.compose(A, style, ticker=None, conn=None, now=NOW)
    assert "Equity curve couldn't load. Type / to add it again." in _lines(out["bodyJson"])


def test_update_layout_never_offers_a_family_slot(db, monkeypatch):
    from api.services.journal_two import journal_styles as js, notes
    spy = _RunSpy(monkeypatch)
    s = js.create_style(A, {"name": "T", "kindId": "trade_plan",
                            "blocks": [{"block": "built_a", "settings": {"ref": SHELF, "defRev": 1}}]})
    older = notes.create_note(A, {"title": "old", "bodyJson": {"type": "doc", "content": [
        js._h("Prep"), js._p("Up 2R.")]}}, style_stamp=(s["id"], s["version"], "trade_plan"))
    plan = js.plan_style_update(A, older["id"])
    assert plan["add"] == [] and plan["missingBlocks"] is False
    note, _ = js.apply_style_update(A, older["id"], expected_updated_at=older["updatedAt"])
    assert note["bodyJson"]["content"] == older["bodyJson"]["content"] and spy.calls == []
    # an EMPTY note switched to the template is a create: listed (named, nothing run), then filled by the write
    blank = notes.create_note(A, {"title": "blank", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    plan = js.plan_style_update(A, blank["id"], style_id=s["id"])
    assert plan["add"] == [{"block": "built_a", "label": "Equity curve"}] and spy.calls == []
    note, _ = js.apply_style_update(A, blank["id"], style_id=s["id"], expected_updated_at=blank["updatedAt"])
    assert len(spy.calls) == 1 and len(_built_nodes(note["bodyJson"])) == 1


# ── W11-R21: display names ──────────────────────────────────────────────────────────────────────

def test_served_style_and_preview_carry_slot_names_resolved_for_the_member(db, monkeypatch):
    from api.services.journal_two import journal_styles as js
    mine, theirs = _def(name="Setups this month"), _def(uid=B, name="Their widget")
    s = js.create_style(A, {"name": "T", "kindId": "trade_plan", "blocks": [
        {"block": "chart", "settings": {"tf": "D"}},
        {"block": "built_a", "settings": {"ref": SHELF, "defRev": 1}},
        {"block": "built_b", "settings": {"ref": f"def:{mine['id']}", "defRev": 1}},
        {"block": "built_c", "settings": {"ref": f"def:{theirs['id']}", "defRev": 1}}]})
    defs = _DefsSpy(monkeypatch)
    want = {"built_a": "Equity curve", "built_b": "Setups this month",
            "built_c": "This widget is not in your account."}
    assert js.served_style(js.get_style(A, s["id"]), A)["slotNames"] == want
    assert js.preview(A, {"styleId": s["id"]})["slotNames"] == want
    assert {u for _, u in defs.users} == {A}
    assert "slotNames" not in js.served_style(js.get_style(A, s["id"]))               # no member: no names
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))                              # dark: byte-identical
    served = js.served_style(js.get_style(A, s["id"]), A)
    assert "slotNames" not in served and [b["block"] for b in served["blocks"]] == ["chart"]
    assert "slotNames" not in js.preview(A, {"styleId": s["id"]})


def test_the_router_serves_slot_names():
    """The router hands the session member to every served_style, so the editor can name each slot."""
    import ast
    tree = ast.parse(Path("api/routers/notebook_journal_styles.py").read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "served_style"]
    assert len(calls) >= 5                                                              # non-vacuity
    lists = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "served_styles"]
    assert len(lists) == 1 and ast.unparse(lists[0].args[1]) == "user['id']"            # the list: one read
    for c in calls:
        assert len(c.args) == 2 and ast.unparse(c.args[1]) == "user['id']", ast.unparse(c)


# ── 11.3 re-review m-1..m-4 ─────────────────────────────────────────────────────────────────────

def _store_blocks(style_id, extra):
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        stored = json.loads(conn.execute("SELECT blocks_json FROM j2_journal_styles WHERE id = ?",
                                         (style_id,)).fetchone()["blocks_json"])
        conn.execute("UPDATE j2_journal_styles SET blocks_json = ? WHERE id = ?",
                     (json.dumps(stored + extra), style_id))
        conn.commit()
    finally:
        conn.close()


def test_a_legacy_kept_built_block_is_re_reduced_before_it_is_filled(db, monkeypatch):
    """m-3: settings kept from a legacy row are stored verbatim, so the builder re-runs slot_settings_of; settings
    that do not read are the unreadable-widget sentence and run nothing."""
    from api.services.journal_two import journal_styles as js
    s = js.create_style(A, {"name": "Old", "kindId": "trade_plan", "blocks": [{"block": "chart", "settings": {}}]})
    legacy = {"block": "built_a", "enabled": True, "settings": {"ref": "def:not-a-uuid", "defRev": 1}}
    _store_blocks(s["id"], [legacy])
    got = js.update_style(A, s["id"], {"blocks": js.served_style(js.get_style(A, s["id"]))["blocks"]})
    assert got["blocks"][-1] == legacy                                                  # kept verbatim on save
    spy = _RunSpy(monkeypatch)
    out = js.compose(A, js.get_style(A, s["id"]), ticker="NVDA", conn=None, now=NOW)
    assert "This widget couldn't be read." in _lines(out["bodyJson"]) and spy.calls == []
    assert {"block": "built_a", "reason": "slot-unreadable:built_a"} in out["skipped"]
    assert js.served_style(js.get_style(A, s["id"]), A)["slotNames"] == {"built_a": "This widget couldn't be read."}


def test_a_stored_id_fullmatch_refuses_is_kept_by_the_legacy_rule(db):
    """m-1: `chart\\n` passed `.match` before Task 11.3 (an unknown block kept verbatim). A style stored so still
    saves, the id kept exactly; a NEW such id, or the same id with other settings, is still refused."""
    from api.services.journal_two import journal_styles as js
    s = js.create_style(A, {"name": "Old", "kindId": "trade_plan", "blocks": [{"block": "chart", "settings": {}}]})
    legacy = {"block": "chart\n", "enabled": True, "settings": {"tf": "W"}}
    _store_blocks(s["id"], [legacy])
    seen = js.get_style(A, s["id"])["blocks"]
    got = js.update_style(A, s["id"], {"blocks": seen})
    assert got["blocks"][-1] == legacy
    with pytest.raises(js.StyleValidationError, match="valid block id"):
        js.update_style(A, s["id"], {"blocks": seen + [{"block": "zz\n", "settings": {}}]})
    with pytest.raises(js.StyleValidationError, match="valid block id"):
        js.update_style(A, s["id"], {"blocks": seen[:-1] + [{"block": "chart\n", "settings": {"tf": "D"}}]})


def test_the_legacy_keep_reaches_duplicate_and_the_draft_preview(db):
    """m-2: duplicating a legacy style, and previewing its draft in the editor, keep the stored blocks too."""
    from api.services.journal_two import journal_styles as js
    s = js.create_style(A, {"name": "Old", "kindId": "trade_plan", "blocks": [{"block": "chart", "settings": {}}]})
    fam = {"block": "built_a", "enabled": True, "settings": {"whatever": "kept"}}
    bad_id = {"block": "chart\n", "enabled": True, "settings": {"tf": "W"}}
    _store_blocks(s["id"], [fam, bad_id])
    blocks = js.get_style(A, s["id"])["blocks"]
    copy = js.create_style(A, {"name": "Copy", "kindId": "trade_plan", "blocks": blocks, "duplicateOf": s["id"]})
    assert copy["blocks"][-2:] == [fam, bad_id]
    out = js.preview(A, {"style": {"name": "Old", "kindId": "trade_plan", "blocks": blocks}})
    assert "bodyJson" in out
    # still strict for what was never stored: another member's draft, or a fresh create
    with pytest.raises(js.StyleValidationError):
        js.preview(B, {"style": {"name": "x", "kindId": "trade_plan", "blocks": blocks}})
    with pytest.raises(js.StyleValidationError):
        js.create_style(A, {"name": "New", "kindId": "trade_plan", "blocks": blocks})


def test_create_only_membership_follows_wave_11_and_the_plan_tests_it_after_the_wave_skip(db, monkeypatch):
    """m-4: `CREATE_ONLY_BLOCKS` is a `_KnownBlocks`, so a wave 10 kind's membership is flag-dependent; the update
    planner tests it only after `_slot_wave_off`, so a dark kind is never listed or offered."""
    from api.services.journal_two import journal_styles as js, notebook_widgets as nw, notes
    monkeypatch.setattr(nw, "build", lambda kind, *a, **k: {"asOf": "2026-10-24T00:00:00Z"})
    assert "myGamePlan" in js.CREATE_ONLY_BLOCKS
    s = js.create_style(A, {"name": "T", "kindId": "trade_plan", "blocks": [{"block": "myGamePlan", "settings": {}}]})
    blank = notes.create_note(A, {"title": "b", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    assert [x["block"] for x in js.plan_style_update(A, blank["id"], style_id=s["id"])["add"]] == ["myGamePlan"]
    _waves(monkeypatch, *(w for w in ALL_ON if w != 11))
    assert "myGamePlan" not in js.CREATE_ONLY_BLOCKS and "reminder" in js.CREATE_ONLY_BLOCKS
    assert js.plan_style_update(A, blank["id"], style_id=s["id"])["add"] == []


# ── Fix round 1 ─────────────────────────────────────────────────────────────────────────────────

def test_a_big_template_never_starves_another_members_slot(db, monkeypatch):
    """I-1: member A fills 10 built slots while member B fills 1. A holds at most run.MEMBER_MAX pool permits at
    once (the rest queue on the request thread), so B's slot fills and nothing answers "couldn't load"."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two.widget_engine import run
    lock, live, peak = threading.Lock(), {A: 0, B: 0}, {A: 0, B: 0}
    tasks, tasks_peak = {A: 0, B: 0}, {A: 0, B: 0}         # slot tasks holding a pool permit, per member

    def through_the_real_gate(user_id, plan, settings, *, lane, def_id=None, def_rev=None, latest_rev=None,
                              now=None, sample=False):
        with lock:
            tasks[user_id] += 1
            tasks_peak[user_id] = max(tasks_peak[user_id], tasks[user_id])
        try:
            return _gated(user_id, plan, lane, def_id, def_rev)
        finally:
            with lock:
                tasks[user_id] -= 1

    def _gated(user_id, plan, lane, def_id, def_rev):
        with run.admit(user_id, lane):                     # the engine's own gates: MEMBER_MAX, BUILDER_MAX
            with lock:
                live[user_id] += 1
                peak[user_id] = max(peak[user_id], live[user_id])
            time.sleep(0.15)
            with lock:
                live[user_id] -= 1
        return _fake_payload(def_id, def_rev, plan)
    monkeypatch.setattr(run, "run_plan", through_the_real_gate)
    big = _style(*[(f"built_{js.slot_key(i)}", {"ref": SHELF, "defRev": 1}) for i in range(10)])
    small = _style(("built_a", {"ref": SHELF, "defRev": 1}))
    outs = {}

    def go(uid, style):
        outs[uid] = js.compose(uid, style, ticker=None, conn=None, now=NOW)
    t = threading.Thread(target=go, args=(A, big))
    t.start()
    time.sleep(0.05)
    go(B, small)
    t.join(10)
    for uid, n in ((A, 10), (B, 1)):
        body = outs[uid]["bodyJson"]
        assert len(_built_nodes(body)) == n, uid
        assert not [x for x in _lines(body) if "couldn't load" in x], uid
    assert peak[A] <= run.MEMBER_MAX
    assert tasks_peak[A] <= run.MEMBER_MAX                 # the queue is on the request thread, not in the pool


def test_an_engine_busy_for_the_whole_budget_is_the_sentence_inside_the_budget(db, monkeypatch):
    """m-3: busy every time: the slot is re-dispatched (more than one try, no task sleeping on a permit), then it
    is "couldn't load" within SLOT_BUDGET_S plus a margin."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two.widget_engine import run
    monkeypatch.setattr(js, "SLOT_BUDGET_S", 0.6)
    tries = []

    def always_busy(*a, **k):
        tries.append(time.monotonic())
        raise run.EngineBusy()
    monkeypatch.setattr(run, "run_plan", always_busy)
    t0 = time.monotonic()
    out = js.compose(A, _style(("built_a", {"ref": SHELF, "defRev": 1})), ticker=None, conn=None, now=NOW)
    took = time.monotonic() - t0
    assert len(tries) > 1 and took < js.SLOT_BUDGET_S + 0.5, (len(tries), took)
    assert "Equity curve couldn't load. Type / to add it again." in _lines(out["bodyJson"])
    assert out["skipped"] == [{"block": "built_a", "reason": "widget-failed:built_a"}]


def _dark_style(def_id):
    para = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
    return {"name": "T", "kindId": "trade_plan", "blocks": [
        {"block": "chart", "settings": {"tf": "D"}},
        {"block": "built_a", "settings": {"ref": f"def:{def_id}", "defRev": 1}},
        {"block": "built_b", "settings": {"ref": SHELF, "defRev": 2}},
        {"block": "built_c", "settings": {"ref": SHELF, "defRev": 1}}],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Prep"}]},
            para("{{block:built_a}}"), para("{{block:built_b}}"), para("{{block:built_c}}")]}}


def test_one_decider_hides_a_dark_member_plan_on_every_path(db, monkeypatch):
    """I-2: a `def:` slot whose plan needs wave 10 is hidden by served_style, slotNames, the preview and compose
    while waves 9 and 10 are off, exactly like a shelf slot pinned to a wave 10 revision, and kept on save."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two.widget_engine import shelf
    d = _def(name="My drawdown", plan=json.loads(json.dumps(shelf.revision(SHELF, 2)["plan"])))
    s = js.create_style(A, _dark_style(d["id"]))
    spy = _RunSpy(monkeypatch)
    _waves(monkeypatch, *(w for w in ALL_ON if w not in (9, 10)))
    served = js.served_style(js.get_style(A, s["id"]), A)
    assert [b["block"] for b in served["blocks"]] == ["chart", "built_c"]
    text = json.dumps(served["outlineBodyJson"])
    assert "built_a" not in text and "built_b" not in text and "{{block:built_c}}" in text
    assert served["slotNames"] == {"built_c": "Equity curve"}                           # names only what is shown
    listed = js.served_styles([js.get_style(A, s["id"])], A)[0]
    assert [b["block"] for b in listed["blocks"]] == ["chart", "built_c"]
    previewed = js.preview(A, {"styleId": s["id"]})
    assert previewed["slotNames"] == {"built_c": "Equity curve"}
    lines = _lines(previewed["bodyJson"])
    assert [x for x in lines if "fills in" in x] == ["Equity curve fills in with your own data when you make a note."]
    out = js.compose(A, js.get_style(A, s["id"]), ticker="NVDA", conn=None, now=NOW)
    assert [c["def_id"] for c in spy.calls] == [SHELF] and len(_built_nodes(out["bodyJson"])) == 1
    assert not [k for k in out["skipped"] if k["block"] in ("built_a", "built_b")]
    assert out["slotNames"] == {"built_c": "Equity curve"}
    got = js.update_style(A, s["id"], {"blocks": served["blocks"]})                     # the editor's save
    assert [b["block"] for b in got["blocks"]] == ["chart", "built_a", "built_b", "built_c"]
    _waves(monkeypatch, *ALL_ON)                                                         # control: all shown
    assert [b["block"] for b in js.served_style(js.get_style(A, s["id"]), A)["blocks"]] == [
        "chart", "built_a", "built_b", "built_c"]


def _traced():
    from api.services import auth_db
    conn = auth_db.get_connection()
    stmts = []
    conn.set_trace_callback(stmts.append)
    return conn, stmts


def test_names_are_one_batched_owned_read_per_request(db, monkeypatch):
    """I-3: every `def:` name of every style in a list is ONE statement on one connection; past the read budget a
    name is the slot word, never an error."""
    from api.services.journal_two import journal_styles as js, slot_fill
    defs = [_def(name=f"W{i}") for i in range(4)]
    ids = []
    for k in range(3):
        ids.append(js.create_style(A, {"name": f"T{k}", "kindId": "trade_plan", "blocks": [
            {"block": f"built_{js.slot_key(i)}", "settings": {"ref": f"def:{d['id']}", "defRev": 1}}
            for i, d in enumerate(defs)]})["id"])
    conn, stmts = _traced()
    try:
        styles = [js.get_style(A, i, conn) for i in ids]
        stmts.clear()
        out = js.served_styles(styles, A, conn)
        reads = [q for q in stmts if "j2_widget_definitions" in q]
        assert len(reads) == 1, reads                                                    # 12 slots, one read
        want = {"built_a": "W0", "built_b": "W1", "built_c": "W2", "built_d": "W3"}
        assert all(o["slotNames"] == want for o in out)
        stmts.clear()
        js.served_style(styles[0], A, conn)
        assert len([q for q in stmts if "j2_widget_definitions" in q]) == 1
        monkeypatch.setattr(slot_fill, "PREFETCH_MAX", 2)
        stmts.clear()
        names = js.served_style(styles[0], A, conn)["slotNames"]
        assert names == {"built_a": "W0", "built_b": "W1", "built_c": "Widget", "built_d": "Widget"}
        assert len([q for q in stmts if "j2_widget_definitions" in q]) == 1             # overflow reads nothing
    finally:
        conn.close()


def test_resolve_many_is_resolve_for_runs_twin(db):
    """The batched read answers what resolve_for_run answers, for every asked revision, a pruned one included."""
    from api.services.journal_two import widget_definitions as wd
    from api.services.auth_db import get_connection
    d = _def(plan=_base_plan("last_7d"))
    for i, token in enumerate(("last_30d", "last_90d", "ytd", "all"), start=1):
        d = wd.update(A, d["id"], if_match=d["etag"], plan=_base_plan(token), apply="only",
                      now=NOW + timedelta(minutes=5 * i))
    conn = get_connection()
    try:
        conn.execute("DELETE FROM j2_widget_definition_revs WHERE definition_id = ? AND rev IN (2, 3)", (d["id"],))
        conn.commit()
    finally:
        conn.close()
    refs = [(d["id"], r) for r in (None, 0, 1, 2, 3, 4, 5, 9, True)]
    many = wd.resolve_many(A, refs)
    for ref in refs:
        plan, rev, latest = wd.resolve_for_run(A, *ref)
        assert (many[ref]["plan"], many[ref]["rev"], many[ref]["latest_rev"]) == (plan, rev, latest), ref
    assert wd.resolve_many(B, refs) == {r: None for r in refs}                         # never another member's


def test_the_pin_follows_update_everywhere_and_a_pruned_pin_runs_the_newest_kept_below_it(db, monkeypatch):
    """m-2, decided and documented (slot_fill's docstring): a template slot is a placement like any other. An
    "Update everywhere" save moves it to the new revision; a pinned revision pruned away runs the newest kept
    revision at or below it (here the placed revision 1), never a newer one."""
    from api.services.journal_two import journal_styles as js, widget_definitions as wd
    from api.services.auth_db import get_connection
    d = _def(plan=_base_plan("last_7d"))
    style = _style(("built_a", {"ref": f"def:{d['id']}", "defRev": 1}))
    d = wd.update(A, d["id"], if_match=d["etag"], plan=_base_plan("last_30d"), apply="update_all",
                  now=NOW + timedelta(minutes=5))
    spy = _RunSpy(monkeypatch)
    js.compose(A, style, ticker=None, conn=None, now=NOW)
    assert (spy.calls[-1]["def_rev"], spy.calls[-1]["plan"]["range"]) == (2, {"token": "last_30d"})
    e = _def(plan=_base_plan("last_7d"))
    for i, token in enumerate(("last_30d", "last_90d", "ytd"), start=1):
        e = wd.update(A, e["id"], if_match=e["etag"], plan=_base_plan(token), apply="only",
                      now=NOW + timedelta(minutes=5 * i))
    conn = get_connection()
    try:
        conn.execute("DELETE FROM j2_widget_definition_revs WHERE definition_id = ? AND rev IN (2, 3)", (e["id"],))
        conn.commit()
    finally:
        conn.close()
    js.compose(A, _style(("built_a", {"ref": f"def:{e['id']}", "defRev": 3})), ticker=None, conn=None, now=NOW)
    assert (spy.calls[-1]["def_rev"], spy.calls[-1]["plan"]["range"]) == (1, {"token": "last_7d"})


def test_a_plan_made_by_a_newer_app_says_so(db):
    """m-1: a too-new plan (stored by a newer pod) is the "newer version" sentence, not "Type / to add it again"."""
    from api.services.journal_two import journal_styles as js
    from api.services.auth_db import get_connection
    d = _def()
    newer = json.dumps({**_base_plan(), "v": 99})
    conn = get_connection()
    try:
        conn.execute("UPDATE j2_widget_definitions SET plan_json = ?, plan_version = 99 WHERE id = ?", (newer, d["id"]))
        conn.execute("UPDATE j2_widget_definition_revs SET plan_json = ? WHERE definition_id = ?", (newer, d["id"]))
        conn.commit()
    finally:
        conn.close()
    out = js.compose(A, _style(("built_a", {"ref": f"def:{d['id']}", "defRev": 1}),
                               ("built_b", {"ref": "inline:d1"})), ticker=None, conn=None, now=NOW,
                     definitions={"d1": {"plan": json.loads(newer), "name": "Shared"}})
    sentence = "This widget was made with a newer version of the app. Reload to use it."
    assert _lines(out["bodyJson"]).count(sentence) == 2
    assert {k["reason"] for k in out["skipped"]} == {"slot-too-new:built_a", "slot-too-new:built_b"}


def test_the_draft_preview_reads_the_members_styles_only_when_a_block_needs_the_legacy_keep(db, monkeypatch):
    """m-5: a draft whose blocks all read never parses the member's stored styles; one that needs the keep does."""
    from api.services.journal_two import journal_styles as js
    asked = []
    real = js._member_legacy_blocks
    monkeypatch.setattr(js, "_member_legacy_blocks", lambda *a: asked.append(1) or real(*a))
    js.preview(A, {"style": {"name": "D", "kindId": "trade_plan",
                             "blocks": [{"block": "built_a", "settings": {"ref": SHELF, "defRev": 1}}]}})
    assert asked == []
    with pytest.raises(js.StyleValidationError):
        js.preview(A, {"style": {"name": "D", "kindId": "trade_plan",
                                 "blocks": [{"block": "built_a", "settings": {"whatever": "x"}}]}})
    assert asked == [1]
