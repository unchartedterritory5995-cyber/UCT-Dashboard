"""The waves 8-10 ship-walk fix round, server half.

W10.7 (privacy, major): a shared notes-list widget showed the member's real note titles on the public page. The
payload was relabelled ("Note 1"), but the page drew the widget's ARCHIVED IMAGE, a picture of the editor. The fix:

* a public copy of a built widget never carries its archived image (`fallback` is dropped in every mode that shows
  it, so `referenced_images` never serves it), and the page draws the widget from the reduced params;
* every label that is the member's OWN NAME is marked by ONE rule (`widget_engine.payload.label_kinds`, from the
  engine fields' `public_kind`): accounts and note titles as before, and now folders, note tags, note kinds,
  routines, routine items and trackers. The public reducer re-derives the marks from the frozen plan a note carries,
  so a snapshot made before a field was marked is numbered too.

W10.3 (copy): a Notes widget said "Source: your manual trades" (the payload's `source` fallback), and a property sum
never named its property. W8.7 (the archive showed the author's controls) is the image no longer travelling.

The rail the brief asks for: share a notes-list widget with distinctive titles, run by the REAL engine, through EVERY
public mode; the published artifact (the payload and the image it could draw) holds none of them.
"""
from __future__ import annotations

import copy
import json
import uuid

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import public_note_payload as pnp
from api.services.journal_two.widget_engine import payload as wpayload
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import run as wrun
from api.services.journal_two.widget_engine import sources
from tests.test_widget_notes_source import RUN_NOW, add_folder, add_kind, add_n, add_prop, raw
from tests.test_widget_sources import UID, add_trade, conn  # noqa: F401 -- `conn` is a fixture used by name

OWNER, NOTE = UID, "note-walk-1"
BASE = "/api/j2/shared/TOK/att/"
OWN_IMAGE = f"/api/j2/notes/attachments/{OWNER}/{NOTE}/inline/widget-embed.png"


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-walkfix-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")      # the notes source reads kinds
    wrun._reset_state()
    yield
    wrun._reset_state()


def run_out(r):
    return wrun.run_plan(UID, r, {}, lane="run", now=RUN_NOW, sample=False)


def placed(payload: dict, *, share=True) -> dict:
    """A built widget as the editor stores it once placed, shared, and self-archived: the run's payload, the
    member's switch, and the archive image of the editor body (THIS note's own attachment)."""
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "builtWidget", "mode": "snapshot", "capturedAt": "2026-10-29T15:30:00Z",
        "params": {**copy.deepcopy(payload), "share": share},
        "fallback": {"url": OWN_IMAGE, "w": 900, "h": 500}, "caption": "", "layout": {"width": "full"}}}


def reduce(node: dict, mode: str) -> dict:
    return pnp.reduce({"type": "doc", "content": [node]}, mode=mode, owner_id=OWNER, note_id=NOTE,
                      attachment_base=BASE, facts={})


def embed_of(out: dict) -> dict | None:
    for n in out.get("content") or []:
        if n.get("type") == "widgetEmbed":
            return n
    return None


TITLES = ("TITLE-CANARY-Earnings plan TSLA", "TITLE-CANARY-Idea 3", "TITLE-CANARY-Monday review")


# ── the brief's rail: a shared notes list, the real engine, every public mode ───────────────────────

@pytest.mark.parametrize("mode", pnp.MODES)
def test_shared_notes_list_publishes_no_title_and_no_image_in_any_mode(conn, mode):
    for t in TITLES:
        add_n(conn, UID, title=t)
    out = run_out(raw(view={"type": "list"}))
    assert {r["label"] for r in out["rows"]} == set(TITLES)          # control: the run really holds the titles
    reduced = reduce(placed(out), mode)
    blob = json.dumps(reduced)
    for t in TITLES:
        assert t not in blob, (mode, t)
    assert "TITLE-CANARY" not in blob, mode
    # the image of the editor (which drew the real titles) never travels, and so is never served
    assert "widget-embed.png" not in blob, mode
    assert pnp.referenced_images(reduced, BASE) == frozenset(), mode
    node = embed_of(reduced)
    if mode in ("share", "publish"):
        assert node is not None and "fallback" not in node["attrs"]
        assert sorted({r["label"] for r in node["attrs"]["params"]["rows"]}) == ["Note 1", "Note 2", "Note 3"]
    else:
        assert node is None                                          # gallery and example: the account line only


def test_the_same_widget_unshared_publishes_nothing_but_the_line(conn):
    for t in TITLES:
        add_n(conn, UID, title=t)
    out = run_out(raw(view={"type": "list"}))
    for mode in pnp.MODES:
        blob = json.dumps(reduce(placed(out, share=False), mode))
        assert "TITLE-CANARY" not in blob and "widget-embed.png" not in blob, mode


def test_walk_fix_built_widget_publishes_no_image():
    """Even a built widget with no private label: its image is a picture of the member's editor (their controls,
    W8.7), so it never travels; a phase 1 account kind's image is unchanged (control: the rule is the built
    widget's, and the reducer still keeps an image where it did)."""
    node = placed({"title": "Win rate", "view": "number", "value": {"v1": 0.5}, "measures": []})
    for mode in ("share", "publish"):
        assert "fallback" not in embed_of(reduce(node, mode))["attrs"], mode
    phase1 = copy.deepcopy(node)
    phase1["attrs"]["widgetId"] = "myPnlStats"
    phase1["attrs"]["params"] = {"share": True, "netPnl": 10}
    kept = embed_of(reduce(phase1, "share"))["attrs"]
    assert kept["fallback"]["url"].startswith(BASE)


# ── every private name, by the one rule ─────────────────────────────────────────────────────────────

def test_every_member_named_field_is_marked_and_every_mark_has_a_word():
    """A field whose group label is read from a member's own name (`label_from`) is marked `public_kind`; so is a
    note tag. Every mark, and every source's list mark, has its numbering word in RELABEL_WORDS (by name)."""
    missing, marks = [], set()
    for src in sources.SOURCES.values():
        for key, f in src.fields.items():
            if f.label_from and f.public_kind is None:
                missing.append(f"{src.key}.{key}")
            if f.public_kind:
                marks.add(f.public_kind)
        if src.list_public_kind:
            marks.add(src.list_public_kind)
    assert missing == []
    assert sources.NOTES.fields["tag"].public_kind == "tag"
    assert sorted(marks - set(pnp.RELABEL_WORDS)) == []
    assert marks == {"account", "note", "folder", "tag", "kind", "routine", "item", "tracker"}
    # control: the names a shared widget DOES show (the phase 1 rule) are not marked
    for src_key, key in (("closed_trades", "setup"), ("closed_trades", "symbol"), ("closed_trades", "mistake"),
                         ("options_strategies", "underlying"), ("options_strategies", "strategy"),
                         ("notes", "ticker")):
        assert sources.SOURCES[src_key].fields[key].public_kind is None, (src_key, key)


@pytest.mark.parametrize("plan,want", [
    ({"source": "notes", "view": {"type": "list"}}, ("note", None)),
    ({"source": "routine_history", "view": {"type": "list"}}, ("routine", None)),
    ({"source": "tracker_history", "view": {"type": "list"}}, ("tracker", None)),
    ({"source": "closed_trades", "view": {"type": "list"}}, (None, None)),
    ({"source": "notes", "split": {"by": "folder", "then": "tag"}, "view": {"type": "table"}}, ("folder", "tag")),
    ({"source": "notes", "split": {"by": "kind"}, "view": {"type": "bar"}}, ("kind", None)),
    ({"source": "routine_history", "split": {"by": "routine", "then": "item"}}, ("routine", "item")),
    ({"source": "closed_trades", "split": {"by": "setup", "then": "account"}}, (None, "account")),
    ({"source": "options_strategies", "split": {"by": "account"}}, ("account", None)),
    ({"source": "notes", "split": {"by": "formula:f1"},
      "formulas": [{"id": "f1", "name": "Where", "expr": "If([created] > 0, [folder], [ticker])"}]}, ("folder", None)),
    ({"source": "notes", "split": {"by": "formula:f1"},
      "formulas": [{"id": "f1", "name": "Loop", "expr": "[formula:f1]"}]}, (None, None)),
    ("not a plan", (None, None)),
    ({"source": "no such source", "view": {"type": "list"}}, (None, None)),
    ({"source": "notes", "split": "folder"}, (None, None)),
])
def test_label_kinds_one_rule(plan, want):
    assert wpayload.label_kinds(plan) == want


def test_folder_tag_and_kind_splits_are_numbered_on_a_public_page(conn):
    a = add_folder(conn, UID, "FOLDER-CANARY-Secret plays")
    b = add_folder(conn, UID, "FOLDER-CANARY-Earnings")
    k = add_kind(conn, UID, "KIND-CANARY-Swing journal")
    add_n(conn, UID, folder=a, tags=["TAG-CANARY-revenge"], kind=k)
    add_n(conn, UID, folder=b, tags=["TAG-CANARY-calm"])
    for split, word, canary in ((("folder", None), "Folder", "FOLDER-CANARY"), (("tag", None), "Tag", "TAG-CANARY"),
                                (("kind", None), "Note kind", "KIND-CANARY"),
                                (("folder", "tag"), "Folder", "CANARY")):
        sp = {"by": split[0], **({"then": split[1]} if split[1] else {})}
        out = run_out(raw(split=sp, view={"type": "table"}))
        assert canary in json.dumps(out["rows"]), split                 # control: the member's own run names them
        for mode in ("share", "publish"):
            params = embed_of(reduce(placed(out), mode))["attrs"]["params"]
            assert canary not in json.dumps(params), (split, mode)
            assert any(str(r.get("label") or "").startswith(word) for r in params["rows"]), (split, mode)


def test_a_snapshot_made_before_the_mark_is_numbered_from_its_frozen_plan(conn):
    """The reducer re-derives the mark from the plan the note carries: a stored payload with NO `labelKind` (made
    before this fix, or by an older server) is still numbered. Control: with no frozen plan and no mark, the label
    passes, so the derivation is what removed it."""
    f = add_folder(conn, UID, "FOLDER-CANARY-old")
    add_n(conn, UID, folder=f)
    out = run_out(raw(split={"by": "folder"}, view={"type": "bar"}))
    assert out["labelKind"] == "folder" and isinstance(out.get("def"), dict)
    old = {k: v for k, v in out.items() if k not in ("labelKind", "label2Kind")}
    assert "FOLDER-CANARY" not in json.dumps(reduce(placed(old), "share"))
    no_plan = {k: v for k, v in old.items() if k != "def"}
    assert "FOLDER-CANARY" in json.dumps(reduce(placed(no_plan), "share"))


def test_routine_names_and_items_are_marked_by_the_payload():
    """The routine source's split and list labels are member names (W9 routines): the marks are on the fields."""
    assert sources.ROUTINE_HISTORY.fields["routine"].public_kind == "routine"
    assert sources.ROUTINE_HISTORY.fields["item"].public_kind == "item"
    assert sources.TRACKER_HISTORY.fields["tracker"].public_kind == "tracker"
    assert sources.ROUTINE_HISTORY.list_public_kind == "routine"
    assert sources.TRACKER_HISTORY.list_public_kind == "tracker"


# ── W10.3: the copy follows the source ──────────────────────────────────────────────────────────────

def test_a_notes_widget_names_no_trades(conn):
    add_n(conn, UID, title="x")
    out = run_out(raw())
    assert out["source"] is None                                     # no "Source: your manual trades"
    assert out["sourceDetail"] == "Your notes in the Journal."
    assert out["measures"][0]["unit"] == "notes"
    # public: a stored notes widget that still carries the old `source` publishes none
    stale = {**out, "source": "manual"}
    assert "source" not in embed_of(reduce(placed(stale), "share"))["attrs"]["params"]


def test_every_source_has_its_own_provenance_sentence_and_only_trade_sources_name_an_origin(conn):
    for key, src in sources.SOURCES.items():
        line = nw.source_detail(nw.BUILT_KIND, {"sourceKey": key})
        assert isinstance(line, str) and line, key
        if key not in sources.ORIGIN_SOURCES:
            assert "trade" not in line.lower(), (key, line)
    assert sources.ORIGIN_SOURCES == {"closed_trades", "open_positions", "trading_days"}
    assert sources.ORIGIN_SOURCES <= set(sources.SOURCES)
    # control: a closed-trades widget still says where its trades came from
    add_trade(conn, UID, day="2026-10-28")
    out = run_out({"v": 1, "source": "closed_trades", "measures": [{"key": "net_pnl"}], "range": {"token": "all"}})
    assert out["source"] in ("broker", "manual", "mixed")


def test_sum_of_a_property_names_its_property(conn):
    pid = add_prop(conn, UID, "Conviction")
    add_n(conn, UID, props={pid: 3})
    add_n(conn, UID, props={pid: 4})
    out = run_out(raw(measures=({"key": "notes"}, {"key": "property_sum", "prop": pid})))
    assert out["value"]["v2"] == 7.0
    assert out["measures"][1]["label"] == "Sum of a property: Conviction"
    assert "Sum of a property: Conviction" in out["title"]
    assert "Sum of a property: Conviction" in out["summary"]
    # control: a property the member no longer has is not named (and its notice says so)
    gone = run_out(raw(measures=({"key": "property_sum", "prop": uuid.uuid4().hex},)))
    assert gone["measures"][0]["label"] == "Sum of a property"


def test_property_name_is_total():
    assert wplan.property_name({"key": "property_sum", "prop": "p"}, {"p": "Edge"}) == "Edge"
    assert wplan.property_name({"key": "net_pnl", "prop": "p"}, {"p": "Edge"}) is None
    assert wplan.property_name({"key": "property_sum", "prop": "p"}, None) is None
    assert wplan.property_name("x", {"p": "Edge"}) is None


# ── fix round 2 ─────────────────────────────────────────────────────────────────────────────────────

from pathlib import Path  # noqa: E402

DAYSTATE = ("DAYSTATE-CANARY-Pre-market", 7777.0, 4321)


def _tool_payload(source: str, *, with_def=True, split=None) -> dict:
    """A shared built widget over routine or tracker data, as a run stores it: every day-state value and count is a
    canary, so any one of them reaching a public payload is found."""
    name, value, count = DAYSTATE
    plan = {"v": 2, "source": source, "measures": [{"key": "days_done" if source != "tracker_history" else "average"}],
            "range": {"token": "last_90d"}, "view": {"type": "table"}, **({"split": split} if split else {})}
    p = {"asOf": "2026-10-29T15:30:00Z", "title": "My routine", "view": "table", "sourceKey": source,
         "count": count, "measures": [{"label": "Days done", "unit": "days", "kind": "count", "fmt": "count"}],
         "value": {"v1": value, "n1": count, "n": count},
         "rows": [{"label": name, "label2": "2026-10-28", "v1": value, "n1": count, "s1": "", "n": count}],
         "series": [], "points": [], "cells": [], "rangeLabel": "Last 90 days", "labelKind": "routine"}
    if with_def:
        p["def"] = plan
    return p


@pytest.mark.parametrize("source", ["routine_history", "tracker_history"])
@pytest.mark.parametrize("mode", ["share", "publish"])
def test_r73_routine_and_tracker_widgets_serve_no_data_publicly(source, mode):
    out = reduce(placed(_tool_payload(source)), mode)
    blob = json.dumps(out)
    assert embed_of(out) is None
    texts = [c["content"][0]["text"] for c in out["content"] if c.get("type") == "paragraph" and c.get("content")]
    assert texts == [pnp.HIDDEN_WIDGET_LINE]
    assert pnp.HIDDEN_WIDGET_LINE == "This widget isn't shown on public pages."
    for canary in ("DAYSTATE-CANARY", "7777", "4321", "Days done", "widget-embed.png"):
        assert canary not in blob, (source, mode, canary)


@pytest.mark.parametrize("payload", [
    pytest.param(_tool_payload("routine_history", with_def=False), id="older-snapshot-defRef-routine"),
    pytest.param(_tool_payload("tracker_history", with_def=False), id="older-snapshot-defRef-tracker"),
    pytest.param({**_tool_payload("trading_days"), "def": {"v": 2, "source": "trading_days",
                  "measures": [{"key": "net_pnl"}], "range": {"token": "last_90d"},
                  "split": {"by": "routine_done", "ref": "r-1"}, "view": {"type": "bar"}}}, id="trading-days-routine-split"),
])
def test_r73_covers_older_snapshots_and_routine_fields(payload):
    blob = json.dumps(reduce(placed(payload), "share"))
    assert "DAYSTATE-CANARY" not in blob and "7777" not in blob
    assert pnp.HIDDEN_WIDGET_LINE in blob


def test_r73_control_a_non_routine_built_widget_still_renders():
    p = {**_tool_payload("closed_trades"), "def": {"v": 1, "source": "closed_trades", "measures": [{"key": "net_pnl"}],
                                                   "range": {"token": "last_90d"}, "view": {"type": "number"}}}
    node = embed_of(reduce(placed(p), "share"))
    assert node is not None and node["attrs"]["params"]["value"]["v1"] == 7777.0
    assert wpayload.hidden_publicly(p["def"]) is False
    assert wpayload.hidden_publicly(None, "routine_history") and not wpayload.hidden_publicly(None, None)


PROP_CANARY = "PROPNAME-CANARY-Conviction"


def test_r74_a_property_name_never_reaches_the_public_payload(conn):
    pid = add_prop(conn, UID, PROP_CANARY)
    pid2 = add_prop(conn, UID, "PROPNAME-CANARY-Size")
    add_n(conn, UID, props={pid: 3, pid2: 1})
    out = run_out(raw(measures=({"key": "property_sum", "prop": pid}, {"key": "property_sum", "prop": pid2},
                                {"key": "property_sum", "prop": pid})))
    assert PROP_CANARY in out["title"]                                    # control: the member's own run names it
    for mode in ("share", "publish"):
        params = embed_of(reduce(placed(out), mode))["attrs"]["params"]
        assert "PROPNAME-CANARY" not in json.dumps(params), mode
        assert [m["label"] for m in params["measures"]] == ["Sum of Property 1", "Sum of Property 2", "Sum of Property 1"]
        assert "Sum of Property 1" in params["title"]
    # an older snapshot with no frozen plan: matched by the catalog's words
    old = {k: v for k, v in out.items() if k != "def"}
    assert "PROPNAME-CANARY" not in json.dumps(reduce(placed(old), "share"))


def test_r74_formula_names_stay():
    p = {"title": "Edge", "measures": [{"label": "My edge (average)"}, {"label": "Sum of a property: X"}],
         "def": {"source": "notes", "measures": [{"formula": "f1", "agg": "avg"}, {"key": "property_sum", "prop": "p"}]}}
    ms, _ = wpayload.public_property_labels(p["def"], p["measures"], p["title"])
    assert [m["label"] for m in ms] == ["My edge (average)", "Sum of Property 1"]


# The client renders what the server serves for these cases through ReadOnlyNote (the public page's renderer):
# app/src/pages/journal-2-0/public/ReadOnlyNote.walkFix.test.jsx reads this file.
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "notebook_public_walkfix.json"


def _fixture_now() -> dict:
    shown = {**_tool_payload("closed_trades"), "title": "Net P&L by setup", "labelKind": None,
             "def": {"v": 1, "source": "closed_trades", "measures": [{"key": "net_pnl"}],
                     "range": {"token": "last_90d"}, "split": {"by": "setup"}, "view": {"type": "table"}},
             "rows": [{"label": "Breakout", "label2": None, "v1": 120.0, "n1": 3, "s1": "", "n": 3}],
             "value": {"v1": 120.0, "n1": 3, "n": 3}, "count": 3,
             "measures": [{"label": "Net P&L", "unit": "trades", "kind": "sum", "fmt": "money"}]}
    body = {"type": "doc", "content": [placed(_tool_payload("routine_history")), placed(_tool_payload("tracker_history")),
                                       placed(shown)]}
    return {m: pnp.reduce(copy.deepcopy(body), mode=m, owner_id=OWNER, note_id=NOTE, attachment_base=BASE, facts={})
            for m in ("share", "publish")}


def test_the_walkfix_fixture_the_client_renders_is_the_reducers_current_output():
    now = json.dumps(_fixture_now(), indent=1, sort_keys=True) + "\n"
    if not FIXTURE.exists() or FIXTURE.read_text(encoding="utf-8").replace("\r\n", "\n") != now:
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        with open(FIXTURE, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(now)
        pytest.fail(f"{FIXTURE.name} was out of date and has been rewritten from the reducer's current output.")
    data = json.loads(now)
    for mode in ("share", "publish"):
        assert "DAYSTATE-CANARY" not in json.dumps(data[mode])
        assert json.dumps(data[mode]).count(pnp.HIDDEN_WIDGET_LINE) == 2


# ── fix round 3 (review-walk-fix.md) ────────────────────────────────────────────────────────────────

from api.services.journal_two.widget_engine import public_words  # noqa: E402


def _days_plan(**kw) -> dict:
    return {"v": 1, "source": "trading_days", "measures": [{"key": "avg_day_pnl"}], "range": {"token": "all"},
            "view": {"type": "number"}, **kw}


def test_i2_day_state_fields_are_derived_from_the_field_definitions():
    """The day-state set is READ from the definitions (a `ref_kind`, or `day_state` for the check-ins), never typed
    beside them: every field naming a routine or tracker is in it, and the check-ins are."""
    for src in sources.SOURCES.values():
        keys = wpayload._day_state_keys(src)
        for k, f in src.fields.items():
            if f.ref_kind is not None:
                assert k in keys, (src.key, k)
    assert wpayload._day_state_keys(sources.DAYS) == {"mood", "focus", "routine_done", "tracker_value",
                                                     "tracker_bucket"}
    assert wpayload._day_state_keys(sources.CLOSED) == frozenset()
    assert "trading_days" in wpayload._sources_with_day_state()
    assert "closed_trades" not in wpayload._sources_with_day_state()


@pytest.mark.parametrize("plan", [
    pytest.param(_days_plan(split={"by": "mood"}, view={"type": "bar"}), id="split-by-mood"),
    pytest.param(_days_plan(split={"by": "weekday", "then": "focus"}, view={"type": "table"}), id="then-by-focus"),
    pytest.param(_days_plan(filters=[{"field": "mood", "op": "gte", "values": [4]}]), id="filter-on-mood"),
    pytest.param(_days_plan(measures=[{"formula": "f1", "agg": "avg"}],
                            formulas=[{"id": "f1", "name": "Calm P&L", "expr": "If([focus] >= 4, [day_net], 0)"}]),
                 id="formula-reads-focus"),
])
def test_i2_a_check_in_plan_is_hidden_publicly(plan):
    assert wpayload.reads_day_state(plan)
    p = {**_tool_payload("trading_days"), "def": plan, "publicHidden": False}   # the plan wins over a stale stamp
    blob = json.dumps(reduce(placed(p), "share"))
    assert pnp.HIDDEN_WIDGET_LINE in blob and "DAYSTATE-CANARY" not in blob and "7777" not in blob


def test_i2_control_a_plain_trading_days_pnl_widget_still_shows():
    plan = _days_plan(split={"by": "weekday"}, view={"type": "bar"})
    assert not wpayload.reads_day_state(plan)
    node = embed_of(reduce(placed({**_tool_payload("trading_days"), "def": plan, "publicHidden": False}), "share"))
    assert node is not None and node["attrs"]["params"]["value"]["v1"] == 7777.0


def test_i1_a_defref_stored_routine_split_trading_days_plan_is_hidden(conn):
    """Review I-1: a plan over DEF_MAX_BYTES is stored by reference, so the reducer has no plan to read; the stamp
    `build_payload` wrote from the plan it RAN decides. Run by the real engine: a Trading days plan split by check-in
    mood (day state, no routine needed to seed), padded with long formulas until it is stored as a `defRef`."""
    expr = " + ".join(["[day_net]"] * 120)
    formulas = [{"id": f"f{i}", "name": f"Pad {i}", "expr": expr} for i in range(1, 4)]
    out = run_out(_days_plan(split={"by": "mood"}, view={"type": "bar"}, formulas=formulas))
    assert "def" not in out and isinstance(out.get("defRef"), dict)          # control: it IS stored by reference
    assert out["publicHidden"] is True
    reduced = reduce(placed(out), "share")
    assert embed_of(reduced) is None and pnp.HIDDEN_WIDGET_LINE in json.dumps(reduced)
    # the same, as the review's case: a routine split (a `ref`), stored by reference with its stamp
    routine = {k: v for k, v in _tool_payload("trading_days", with_def=False).items()}
    routine["publicHidden"] = wpayload.hidden_publicly(_days_plan(split={"by": "routine_done", "ref": "r-1"}))
    assert routine["publicHidden"] is True
    assert pnp.HIDDEN_WIDGET_LINE in json.dumps(reduce(placed(routine), "share"))


def test_i1_the_stamp_and_the_fail_closed_fallback():
    base = _tool_payload("trading_days", with_def=False)
    shown = embed_of(reduce(placed({**base, "publicHidden": False}), "share"))
    assert shown is not None                                              # a stamped plain plan shows
    # an older snapshot: no plan, no stamp -> a source that CAN read day state is hidden (fails closed)
    assert pnp.HIDDEN_WIDGET_LINE in json.dumps(reduce(placed(base), "share"))
    closed = {**_tool_payload("closed_trades", with_def=False)}
    assert embed_of(reduce(placed(closed), "share")) is not None           # ...and one that cannot, shows
    # the stamp itself never travels
    assert "publicHidden" not in shown["attrs"]["params"]


def test_m1_a_long_property_name_leaves_no_fragment_in_the_public_title(conn):
    # 60-character names: the 200-character cut of the member's title falls INSIDE the third name
    names = [f"PROPFRAG-{c}-" + "x" * 49 for c in "ABC"]
    pids = [add_prop(conn, UID, n) for n in names]
    add_n(conn, UID, props={p: 1 for p in pids})
    out = run_out(raw(measures=tuple({"key": "property_sum", "prop": p} for p in pids), split={"by": "weekday"},
                      view={"type": "table"}))
    assert len(out["title"]) == 200 and "PROPFRAG" in out["title"]       # control: the member's title is cut inside one
    for mode in ("share", "publish"):
        params = embed_of(reduce(placed(out), mode))["attrs"]["params"]
        assert "PROPFRAG" not in json.dumps(params) and "xxxxx" not in params["title"], mode
        assert params["title"].startswith("Sum of Property 1, Sum of Property 2 and Sum of Property 3 by weekday")
        assert len(params["title"]) <= 200
    old = {k: v for k, v in out.items() if k != "def"}                     # a defRef snapshot: cut, never a fragment
    t = embed_of(reduce(placed(old), "share"))["attrs"]["params"]["title"]
    assert "PROPFRAG" not in t and "Sum of a property" not in t and "xxxxx" not in t


def test_m7_the_numbering_words_live_in_one_module():
    assert pnp.RELABEL_WORDS is public_words.RELABEL_WORDS
    assert public_words.numbered("property", 2) == "Property 2"
    src = Path(wpayload.__file__).read_text(encoding="utf-8") + Path(pnp.__file__).read_text(encoding="utf-8")
    for word in public_words.RELABEL_WORDS.values():
        assert f'"{word}"' not in src, word                                # never restated beside the table
