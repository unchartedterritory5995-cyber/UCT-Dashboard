"""P2a trader blocks, server half (Task 1A): catalog rows and builders. Tasks 3 and 5 append."""
from __future__ import annotations

import importlib
import os
import tempfile
from datetime import datetime, timezone

import pytest


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


NOW = datetime(2026, 10, 13, 14, 30, tzinfo=timezone.utc)
CTX = {"ticker": None, "now": NOW, "memo": {}, "mode": "create", "user_id": "u1"}


def test_every_trader_block_has_a_catalog_row_and_a_builder():
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    assert tb.BLOCK_IDS == ("preEntryChecklist", "priceStamps", "positionSizing")
    assert set(tb.BLOCK_IDS) <= js.KNOWN_BLOCKS
    assert set(js.BLOCK_BUILDERS) == js.KNOWN_BLOCKS
    for bid in tb.BLOCK_IDS:
        assert js._BLOCK_BY_ID[bid]["search"].startswith("[")


@pytest.mark.parametrize("bid", ["preEntryChecklist", "priceStamps", "positionSizing"])
def test_each_builder_makes_a_body_the_editor_can_build(bid, monkeypatch, db_path):
    from api.services.journal_two import journal_styles as js, notes, regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: None)          # hermetic: no wire read
    kind = js._BLOCK_BY_ID[bid]
    block = {"block": bid, "enabled": True, "settings": {s["key"]: s["default"] for s in kind["settings"]}}
    node, reason = js.BLOCK_BUILDERS[bid](block, dict(CTX, memo={}))
    assert reason is None and node["attrs"]["widgetId"] == bid
    assert node["attrs"]["searchText"] == kind["search"]
    body = notes._validate_body_json({"type": "doc", "content": [node]})
    notes._refuse_unbuildable(body)                                      # raises if the editor could not build it


def test_settings_flow_into_params():
    from api.services.journal_two import journal_styles as js
    node, _ = js.BLOCK_BUILDERS["priceStamps"]({"block": "priceStamps", "settings": {"on": "yes"}}, dict(CTX))
    assert node["attrs"]["params"] == {"on": "yes"}


def _held_breadth(monkeypatch, payload):
    """engine.get_breadth answering `payload` for a HELD read; every call's held_only is recorded, and a
    non-held call (the one that can go on to the breadth vendor fetch) is recorded as such."""
    from api.services import engine
    calls: list[bool] = []

    def get_breadth(held_only: bool = False):
        calls.append(held_only)
        return payload
    monkeypatch.setattr(engine, "get_breadth", get_breadth)
    return calls


def test_the_sizer_records_the_regime_id_it_was_built_in(monkeypatch):
    from api.services.journal_two import journal_styles as js, regime
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": 40, "as_of": "2026-10-13"})
    _held_breadth(monkeypatch, {"wire_date": "2026-10-12"})
    node, _ = js.BLOCK_BUILDERS["positionSizing"]({"block": "positionSizing", "settings": {"grade": "A+"}}, dict(CTX, memo={}))
    assert node["attrs"]["params"] == {"grade": "A+", "regimeId": "orange", "regimeAsOf": "2026-10-13"}


# ── R-W0-2: the sizer's regime is read HELD-ONLY and dated exactly as entry_context dates it ─────

def test_the_sizer_dates_its_regime_exactly_as_entry_context_does(monkeypatch):
    """The wire's normalised exposure carries no date, so entry_context._regime_fields dates the regime by
    the wire run's own date. The sizer's stamp is that same date, never "" and never today."""
    from api.services.journal_two import journal_styles as js, regime, entry_context
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": 95})
    _held_breadth(monkeypatch, {"wire_date": "2026-10-09"})
    node, _ = js.BLOCK_BUILDERS["positionSizing"]({"block": "positionSizing", "settings": {"grade": "A"}}, dict(CTX, memo={}))
    expected = entry_context._regime_fields({})[0]
    assert expected["value"] == "green" and expected["asOf"] == "2026-10-09"           # non-vacuity
    assert node["attrs"]["params"] == {"grade": "A", "regimeId": expected["value"], "regimeAsOf": expected["asOf"]}


def test_a_cold_hold_never_reaches_the_breadth_vendor_and_stamps_nothing(monkeypatch):
    """Nothing held: the sizer stays unstamped (the client stamps today's regime on the first change), and
    no read that could go on to morning_wire_engine.fetch_breadth was made."""
    from api.services.journal_two import journal_styles as js, regime
    reads: list[str] = []
    monkeypatch.setattr(regime, "_read_exposure", lambda: reads.append("exposure") or {"score": 95})
    calls = _held_breadth(monkeypatch, None)
    node, reason = js.BLOCK_BUILDERS["positionSizing"]({"block": "positionSizing", "settings": {"grade": "B"}}, dict(CTX, memo={}))
    assert reason is None and node["attrs"]["params"] == {"grade": "B"}
    assert calls == [True]                      # one read, and it was the held one
    assert reads == []                          # the default (vendor-capable) path was never entered


def test_the_sizer_reads_the_composes_one_frozen_regime(monkeypatch):
    """One compose, one regime reading: a reading already frozen in the compose's memo (by the market
    context or another block) is the one the sizer stamps."""
    from api.services.journal_two import journal_styles as js, regime, entry_context
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": 95, "as_of": "2026-10-13"})
    _held_breadth(monkeypatch, {"wire_date": "2026-10-13"})
    frozen = (entry_context._field("red", entry_context.SRC_REGIME, "2026-10-01"),
              entry_context._field(3.0, entry_context.SRC_EXPOSURE, "2026-10-01"))
    node, _ = js.BLOCK_BUILDERS["positionSizing"]({"block": "positionSizing", "settings": {"grade": "A"}},
                                                  dict(CTX, memo={"regime": frozen}))
    assert node["attrs"]["params"] == {"grade": "A", "regimeId": "red", "regimeAsOf": "2026-10-01"}


# ── the build mode (IR-S11, integrator ruling R-RC-1) ─────────────────────────────────────────
# A builder must know whether it serves a NEW note ("create": a market context captures) or offers
# a block to an existing one ("update": uncaptured). R-RC-1: compose takes the REAL mode, an empty
# note switched to a style is create-equivalent, an "Update layout" on a note with content is
# "update", and the dry run reports the mode the write will use. These rails observe the mode the
# BUILDER actually receives, so a hard-wired string anywhere on the path reds them.

def _recording_chart(monkeypatch):
    from api.services.journal_two import journal_styles as js
    seen: list[dict] = []
    real = js.BLOCK_BUILDERS["chart"]

    def chart(block, ctx):
        seen.append({k: ctx.get(k) for k in ("mode", "user_id")} | {"memo": isinstance(ctx.get("memo"), dict)})
        return real(block, ctx)
    monkeypatch.setitem(js.BLOCK_BUILDERS, "chart", chart)
    return seen


def _chart_style(user="u1"):
    from api.services.journal_two import journal_styles as js
    return js.create_style(user, {"name": "Charted", "kindId": "thesis",
        "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "D"}}],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Thesis"}]}]}})


def test_compose_builds_in_create_mode_and_plan_in_update_mode(db_path, monkeypatch):
    from api.services.journal_two import journal_styles as js, notes
    seen = _recording_chart(monkeypatch)
    s = _chart_style()
    js.compose("u1", js.get_style("u1", s["id"]), ticker="NVDA", conn=None, now=NOW)
    assert seen[-1] == {"mode": "create", "user_id": "u1", "memo": True}

    # a note with words in it, made without the chart, then offered the chart by "Update layout"
    n = notes.create_note("u1", {"title": "mine", "ticker": "NVDA", "bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "MY WORDS"}]}]}})
    seen.clear()
    plan = js.plan_style_update("u1", n["id"], style_id=s["id"])
    assert (plan["switching"], plan["insertsOutline"], plan["mode"]) == (True, False, "update")
    assert [x["mode"] for x in seen] == ["update"]


def test_the_dry_run_and_the_write_use_the_same_mode_on_both_branches(db_path, monkeypatch):
    """R-RC-1: preview == apply, for the empty-note switch (create) and for a note with content
    (update). Each branch: the plan's `mode`, the mode the plan's builders saw, and the mode the
    write's builders saw are one value."""
    from api.services.journal_two import journal_styles as js, notes
    seen = _recording_chart(monkeypatch)
    s = _chart_style()
    cases = {
        "empty": notes.create_note("u1", {"title": "blank", "ticker": "NVDA"}),
        "words": notes.create_note("u1", {"title": "mine", "ticker": "NVDA", "bodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "MY WORDS"}]}]}}),
    }
    expected = {"empty": "create", "words": "update"}
    for name, n in cases.items():
        seen.clear()
        plan = js.plan_style_update("u1", n["id"], style_id=s["id"])
        planned = [x["mode"] for x in seen]
        seen.clear()
        note, applied_plan = js.apply_style_update("u1", n["id"], style_id=s["id"],
                                                   expected_updated_at=n["updatedAt"])
        applied = [x["mode"] for x in seen]
        assert plan["mode"] == applied_plan["mode"] == expected[name], name
        assert planned and set(planned) == {expected[name]}, (name, planned)
        assert applied and set(applied) == {expected[name]}, (name, applied)
        assert any(x["type"] == "widgetEmbed" for x in note["bodyJson"]["content"]), name


def test_the_style_preview_composes_a_new_note_in_create_mode(db_path, monkeypatch):
    """The live preview (spec P1.4) shows a NEW note made from the style, so it passes "create"
    explicitly and says so."""
    from api.services.journal_two import journal_styles as js
    seen = _recording_chart(monkeypatch)
    s = _chart_style()
    out = js.preview("u1", {"styleId": s["id"], "ticker": "NVDA"})
    assert out["mode"] == "create"
    assert [x["mode"] for x in seen] == ["create"]


def test_compose_refuses_a_mode_it_does_not_know():
    from api.services.journal_two import journal_styles as js
    with pytest.raises(ValueError):
        js.compose("u1", {"kindId": "thesis", "blocks": []}, ticker=None, conn=None, now=NOW, mode="restore")
