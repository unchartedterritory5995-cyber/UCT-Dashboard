"""Task 11.4: the structure-only sharing reducer (`widget_engine/share.py`, rulings W11-R1, R5, R6)."""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.journal_two import routine_insights, trackers, tracker_days, routine_days
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as S

CAT = S.CATALOG
UUID_A = "0a1b2c3d-1111-4222-8333-000000000001"
UUID_B = "0a1b2c3d-1111-4222-8333-000000000002"
PROP = "a" * 32


@pytest.fixture(autouse=True)
def _kinds_offered(monkeypatch):
    monkeypatch.setitem(S._GATED_FIELDS, ("notes", "kind"), lambda: True)


def _plan(source="closed_trades", **kw):
    p = {"v": 1, "source": source, "measures": [{"key": "net_pnl"}]}
    p.update(kw)
    return p


def _share(plan, **kw):
    return share.share_plan(plan, catalog=CAT, **kw)


def _slot(out, sid):
    return next(s for s in out.slots if s["id"] == sid)


# -- typed slots --------------------------------------------------------------------------------

@pytest.mark.parametrize("source,filt,stype", [
    ("closed_trades", {"field": "setup", "op": "in", "values": ["Breakout"]}, "setup"),
    ("closed_trades", {"field": "mistake", "op": "has_any", "values": ["fomo"]}, "tag"),
    ("closed_trades", {"field": "symbol", "op": "in", "values": ["AAPL"]}, "symbol"),
    ("closed_trades", {"field": "account", "op": "in", "values": ["acc-1"]}, "account"),
    ("notes", {"field": "folder", "op": "in", "values": ["fold-1"]}, "folder"),
    ("notes", {"field": "tag", "op": "has_any", "values": ["ideas"]}, "tag"),
    ("notes", {"field": "kind", "op": "in", "values": ["kind-1"]}, "note_kind"),
    ("routine_history", {"field": "routine", "op": "in", "values": [UUID_A]}, "routine"),
    ("tracker_history", {"field": "tracker", "op": "in", "values": [UUID_A]}, "tracker"),
    ("closed_trades", {"field": "net", "op": "gt", "values": [250]}, "number"),
])
def test_values_become_typed_slots(source, filt, stype):
    measure = {"closed_trades": "net_pnl", "notes": "notes", "routine_history": "routine_completion_pct",
               "tracker_history": "tracker_avg"}[source]
    out = _share({"v": 1, "source": source, "filters": [filt], "measures": [{"key": measure}]})
    [f] = out.payload["plan"]["filters"]
    assert f["field"] == filt["field"] and f["values"] == [{"pick": "p1"}]
    assert out.slots == ({"id": "p1", "type": stype, "label": _slot(out, "p1")["label"], "any": True,
                          "source": source, "field": filt["field"]},)
    if stype != "number":
        assert out.slots[0]["label"] == share.TYPE_LABELS[stype]
    assert out.not_shared


def test_one_account_ref_and_property_become_slots():
    out = _share({"v": 3, "source": "notes", "accounts": "all",
                  "filters": [{"field": "property", "prop": PROP, "op": "eq", "values": [True]}],
                  "measures": [{"key": "property_sum", "prop": PROP}]})
    plan = out.payload["plan"]
    assert plan["filters"][0]["prop"] == {"pick": "p1"} and plan["filters"][0]["values"] == [True]
    assert plan["measures"] == [{"key": "property_sum", "prop": {"pick": "p1"}}]
    # one property, one slot; a measure's prop can't be Any, so the shared slot can't either
    assert out.slots == ({"id": "p1", "type": "property", "label": "Property", "any": False,
                          "source": "notes", "field": "property"},)

    acc = _share(_plan(accounts={"id": "acc-9"}))
    assert acc.payload["plan"]["accounts"] == {"pick": "p1"}
    assert acc.slots[0]["type"] == "account" and acc.slots[0]["any"] is True
    assert "Your account is left out; people pick their own." in acc.not_shared

    ref = _share({"v": 2, "source": "trading_days", "measures": [{"key": "avg_day_pnl"}],
                  "filters": [{"field": "routine_done", "op": "in", "values": ["done"], "ref": UUID_A}],
                  "split": {"by": "routine_done", "ref": UUID_A}, "view": {"type": "bar"}})
    rp = ref.payload["plan"]
    assert rp["filters"][0]["ref"] == {"pick": "p1"} and rp["split"]["ref"] == {"pick": "p1"}
    assert rp["filters"][0]["values"] == ["done"]          # a routine day state is a closed code
    assert ref.slots == ({"id": "p1", "type": "routine", "label": "Routine", "any": False,
                          "source": "trading_days", "field": "routine_done"},)

    builtin = _share({"v": 2, "source": "trading_days", "measures": [{"key": "avg_day_pnl"}],
                      "filters": [{"field": "tracker_value", "op": "gte", "values": [3],
                                   "ref": "checkin:mood"}]}, keep=["filters/0/values/0"])
    assert builtin.payload["plan"]["filters"][0]["ref"] == "checkin:mood"
    assert builtin.slots == ()


def test_enum_values_are_structure():
    filters = [{"field": "side", "op": "in", "values": ["Long"]},
               {"field": "result", "op": "in", "values": ["Win", "BE"]},
               {"field": "weekday", "op": "not_in", "values": ["Monday"]},
               {"field": "hold_bucket", "op": "in", "values": ["Same day"]},
               {"field": "had_stop", "op": "is", "values": [True]}]
    out = _share(_plan(filters=filters))
    assert out.payload["plan"]["filters"] == [{**f, "overridable": False} for f in filters]
    assert out.slots == ()
    # a value outside the field's closed set is not structure: the filter goes
    odd = _share(_plan(filters=[{"field": "side", "op": "in", "values": ["My own side"]}]))
    assert odd.payload["plan"]["filters"] == []
    # an enum with no closed set (a month) is the member's own value: the filter goes
    month = _share(_plan(filters=[{"field": "month", "op": "in", "values": ["2026-10"]}]))
    assert month.payload["plan"]["filters"] == [] and month.slots == ()


def test_fixed_dates_become_last_90_days():
    out = _share(_plan(range={"from": "2026-01-01", "to": "2026-02-01"},
                       filters=[{"field": "day", "op": "between", "values": ["2026-01-05", "2026-01-09"]}],
                       compare={"mode": "range", "from": "2025-01-01", "to": "2025-02-01"}))
    plan = out.payload["plan"]
    assert plan["range"] == {"token": "last_90d"} and plan["filters"] == [] and plan["compare"] is None
    assert any("dates" in s for s in out.not_shared)
    tok = _share(_plan(range={"token": "ytd"}, compare={"mode": "previous"}))
    assert tok.payload["plan"]["range"] == {"token": "ytd"}
    assert tok.payload["plan"]["compare"] == {"mode": "previous"}


def _formula_plan(expr, name="My edge", fmt="number", **kw):
    return _plan(v=3, formulas=[{"id": "f1", "name": name, "expr": expr, "format": fmt}],
                 measures=[{"formula": "f1", "agg": "avg"}], **kw)


def test_formula_names_become_field_n():
    p = _plan(v=3, formulas=[{"id": "f1", "name": "Edge", "expr": "[r]", "format": "r"},
                             {"id": "f2", "name": "Size", "expr": "[shares]", "format": "number"}],
              measures=[{"formula": "f1", "agg": "avg"}, {"formula": "f2", "agg": "sum"}])
    out = _share(p)
    assert [f["name"] for f in out.payload["plan"]["formulas"]] == ["Field 1", "Field 2"]
    named = _share(p, edits={"formulas": {"f2": "  Position size "}})
    assert [f["name"] for f in named.payload["plan"]["formulas"]] == ["Field 1", "Position size"]
    assert "Edge" not in named.payload["name"] and "Field 1" in named.payload["name"]


def test_formula_numeric_literal_becomes_token_unless_kept():
    out = _share(_formula_plan("[r] * 2 + -1.5"))
    [f] = out.payload["plan"]["formulas"]
    assert f["expr"] == "[r] * [#p1] + [#p2]"
    assert [(s["id"], s["type"], s["any"], s["label"]) for s in out.slots] == [
        ("p1", "number", False, "Field 1"), ("p2", "number", False, "Field 1")]
    kept = _share(_formula_plan("[r] * 2 + -1.5"), keep=["formulas/f1/6"])
    assert kept.payload["plan"]["formulas"][0]["expr"] == "[r] * 2 + [#p1]"
    assert kept.kept == ("formulas/f1/6",)


def test_formula_text_literal_refuses_own_words():
    # an enum value of the field it is compared with is structure
    ok = _share(_formula_plan('If([side] = "Long", [r], 0)'))
    assert ok.payload["plan"]["formulas"][0]["expr"] == 'If([side] = "Long", [r], [#p1])'
    wd = _share(_formula_plan('If(Weekday([day]) = "Friday", [r], [r] * 2)'))
    assert '"Friday"' in wd.payload["plan"]["formulas"][0]["expr"]
    for expr in ('If([setup] = "My breakout", [r], 0)', 'If([r] > 1, "big", "small")',
                 'If([symbol] = "AAPL", [r], 0)'):
        fmt = "number"
        with pytest.raises(share.ShareError) as e:
            _share(_formula_plan(expr, fmt=fmt) if "big" not in expr else
                   _plan(v=3, formulas=[{"id": "f1", "name": "x", "expr": expr, "format": fmt}],
                         split={"by": "formula:f1"}, view={"type": "bar"}))
        assert e.value.code == "own_words" and e.value.status == 400
        assert e.value.sentence == "Field 1 uses your own words. Change that part before sharing."


def _template(*blocks):
    return {"name": "Mine", "blocks": list(blocks)}


def test_template_def_refs_become_inline_and_slot_ids_are_shared():
    d1 = {"id": UUID_A, "plan": _plan(filters=[{"field": "setup", "op": "in", "values": ["Flag"]}])}
    d2 = {"id": UUID_B, "plan": _plan(source="open_positions", measures=[{"key": "open_risk"}],
                                      filters=[{"field": "setup", "op": "in", "values": ["Flag"]},
                                               {"field": "days_open", "op": "gt", "values": [3]}])}
    style = _template(
        {"block": "built_a", "enabled": True, "settings": {"ref": "def:" + UUID_A, "defRev": 4,
                                                            "range": {"token": "ytd"}}},
        {"block": "built_b", "enabled": True, "settings": {"ref": "def:" + UUID_B, "defRev": 1}},
        {"block": "built_c", "enabled": False, "settings": {"ref": "def:" + UUID_A, "defRev": 4}})
    out = share.share_template(style, definitions={"def:" + UUID_A: d1, UUID_B: d2}, routines={},
                               trackers={}, catalog=CAT,
                               edits={"blocks": {"built_a": {"name": "Flags by setup"}}})
    p = out.payload
    assert p["format"] == 2
    assert [b["settings"] for b in p["blocks"]] == [
        {"ref": "inline:d1", "range": {"token": "ytd"}}, {"ref": "inline:d2"}, {"ref": "inline:d1"}]
    assert [b["enabled"] for b in p["blocks"]] == [True, True, False]
    assert [d["key"] for d in p["definitions"]] == ["d1", "d2"]
    assert p["definitions"][0]["name"] == "Flags by setup"
    assert set(p["definitions"][0]) == {"key", "plan", "name", "description"}
    # the same setup in two widgets is ONE choice; the number is its own
    assert p["definitions"][0]["plan"]["filters"][0]["values"] == [{"pick": "p1"}]
    assert p["definitions"][1]["plan"]["filters"][0]["values"] == [{"pick": "p1"}]
    assert p["definitions"][1]["plan"]["filters"][1]["values"] == [{"pick": "p2"}]
    assert [s["id"] for s in out.slots] == ["p1", "p2"] and p["slots"] == list(out.slots)

    with pytest.raises(share.ShareError) as e:
        share.share_template(style, definitions={}, routines={}, trackers={}, catalog=CAT)
    assert e.value.code == "not_yours" and e.value.sentence == "This widget is not in your account."
    adopted = {**d1, "sourceGalleryId": "g1"}
    with pytest.raises(share.ShareError) as e:
        share.share_template(style, definitions={"def:" + UUID_A: adopted, UUID_B: d2}, routines={},
                             trackers={}, catalog=CAT)
    assert e.value.code == "adopted"


def test_shelf_and_template_refs_stay():
    routine = {"id": UUID_A, "name": "AM", "items": [{"id": "i1", "text": "Read", "negative": False}],
               "schedule": {"kind": "every"}, "settings": {"done_share": 1.0}}
    style = _template(
        {"block": "built_a", "enabled": True,
         "settings": {"ref": "shelf:win-rate-by-setup", "defRev": 2, "range": {"token": "last_30d"}}},
        {"block": "routine_1", "enabled": True,
         "settings": {"template": "premarket", "bind": "next-trading-day", "display": "items"}},
        {"block": "routine_2", "enabled": True,
         "settings": {"ref": "routine:" + UUID_A, "bind": "week", "display": "pnl"}},
        {"block": "tracker_1", "enabled": True,
         "settings": {"ref": "checkin:focus", "bind": "note-day", "display": "chart"}},
        {"block": "tracker_2", "enabled": True,
         "settings": {"template": "sleep", "bind": "note-day", "display": "pnl"}},
        {"block": "chart", "enabled": True, "settings": {"tf": "W"}})
    out = share.share_template(style, definitions={}, routines={UUID_A: routine}, trackers={},
                               catalog=CAT, edits={"blocks": {"routine_2": {"items": ["Read the wire"]}}})
    p = out.payload
    assert [b["settings"] for b in p["blocks"]] == [
        {"ref": "shelf:win-rate-by-setup", "defRev": 2, "range": {"token": "last_30d"}},
        {"template": "premarket", "bind": "next-trading-day", "display": "items"},
        {"inline": "r1", "bind": "week", "display": "pnl"},
        {"ref": "checkin:focus", "bind": "note-day", "display": "chart"},
        {"template": "sleep", "bind": "note-day", "display": "pnl"},
        {}]
    assert p["blocks"][5]["block"] == "chart"
    assert p["routines"] == [{"key": "r1", "name": "Routine with 1 item",
                              "items": [{"text": "Read the wire", "negative": False}],
                              "schedule": {"kind": "every"}, "settings": {"done_share": 1.0}}]
    assert p["definitions"] == [] and p["trackers"] == []


def test_routine_share_needs_items_and_drops_ids():
    routine = {"id": UUID_A, "name": "Morning", "items": [
        {"id": "i1", "text": "Read the wire", "negative": False, "suggest": None},
        {"id": "i2", "text": "Max 3 trades", "negative": True, "suggest": {"rule": "max_trades", "n": 3}}],
        "schedule": {"kind": "weekdays", "days": [4, 0, 4]},
        "settings": {"done_share": 0.5, "strict": True, "reminder": {"on": True, "time_et": "08:00"}}}
    for edits in (None, {}, {"items": []}, {"items": ["  ", ""]}):
        with pytest.raises(share.ShareError) as e:
            share.share_routine(routine, edits=edits)
        assert e.value.code == "invalid" and e.value.sentence == "Pick at least one item to share."
    out = share.share_routine(routine, edits={"name": " Prep ", "items": ["Wire", {"text": "Limit"}]})
    assert out.payload == {"name": "Prep", "items": [
        {"text": "Wire", "negative": False}, {"text": "Limit", "negative": True,
                                               "suggest": {"rule": "max_trades"}}],
        "schedule": {"kind": "weekdays", "days": [0, 4]}, "settings": {"done_share": 0.5}}
    kept = share.share_routine(routine, edits={"items": ["Wire", "Limit"]}, keep=["items/1/suggest"])
    assert kept.payload["items"][1]["suggest"] == {"rule": "max_trades", "n": 3}
    assert kept.payload["name"] == "Routine with 2 items" and kept.kept == ("items/1/suggest",)
    assert "i1" not in str(kept.payload) and UUID_A not in str(kept.payload)
    with pytest.raises(share.ShareError) as e:
        share.share_routine(routine, edits={"items": ["x"] * 26})
    assert e.value.sentence == "A routine can hold up to 25 items."
    with pytest.raises(share.ShareError) as e:
        share.share_routine(routine, edits={"items": ["x" * 201]})
    assert e.value.sentence == "An item can be at most 200 characters."


def test_tracker_share_never_carries_a_value():
    t = {"id": UUID_A, "name": "Sleep", "kind": "duration", "unit": "h", "settings": {"days": "any"},
         "value": 7.5, "values": [{"day": "2026-10-01", "value": 7}]}
    out = share.share_tracker(t)
    assert out.payload == {"name": "Duration tracker", "kind": "duration", "unit": None, "days": "any"}
    named = share.share_tracker(t, edits={"name": "Sleep hours", "unit": " hrs "})
    assert named.payload == {"name": "Sleep hours", "kind": "duration", "unit": "hrs", "days": "any"}
    for kind, word in (("yesno", "Yes / no"), ("number", "Number"), ("scale", "1-5 scale")):
        assert share.share_tracker({**t, "kind": kind}).payload["name"] == f"{word} tracker"
    assert share.share_tracker({**t, "settings": {}}).payload["days"] == "trading"
    with pytest.raises(share.ShareError) as e:
        share.share_tracker(t, edits={"unit": "x" * 17})
    assert e.value.sentence == "A unit can be at most 16 characters."


def test_name_defaults_to_generated():
    p = _plan(filters=[{"field": "setup", "op": "in", "values": ["Flag"]}], split={"by": "setup"},
              view={"type": "bar"}, range={"token": "last_30d"},
              display={"title": "My secret title", "titleAuto": False})
    out = _share(p)
    reduced = out.payload["plan"]
    assert out.payload["name"] == wplan.default_name(reduced, CAT) == "Net P&L by setup, last 30 days"
    assert out.payload["description"] == wplan.summary(reduced, CAT, None, "trades")
    assert reduced["display"]["title"] == "" and reduced["display"]["titleAuto"] is True
    named = _share(p, edits={"name": "  Flags  ", "description": " Mine "})
    assert named.payload["name"] == "Flags" and named.payload["description"] == "Mine"
    with pytest.raises(share.ShareError) as e:
        _share(p, edits={"name": "x" * 81})
    assert e.value.sentence == "A name can be at most 80 characters."
    with pytest.raises(share.ShareError) as e:
        _share(p, edits={"description": "x" * 281})
    assert e.value.sentence == "A description can be at most 280 characters."


def test_target_dropped_unless_kept_and_slots_capped():
    p = _plan(view={"type": "progress"}, display={"target": 5000})
    assert _share(p).payload["plan"]["display"]["target"] is None
    assert _share(p, keep=["display/target"]).payload["plan"]["display"]["target"] == 5000
    many = _formula_plan(" + ".join(["[r]"] + [str(i) for i in range(1, 22)]))
    with pytest.raises(share.ShareError) as e:
        _share(many)
    assert e.value.code == "invalid"
    with pytest.raises(share.ShareError) as e:
        _share({"v": 1, "source": "nope", "measures": []})
    assert e.value.code == "invalid"


def test_constants_mirror_their_authorities():
    """share.py restates a few closed sets instead of importing database modules; each is pinned
    to its authority here, so a change there reds this rail rather than drifting."""
    assert share.SUGGEST_RULES == routine_insights.SUGGEST_RULES
    assert share.DONE_SHARES == routine_days.DONE_SHARES
    assert share.SCHEDULE_KINDS == routine_days.SCHEDULE_KINDS
    assert share.TRACKER_KINDS == tracker_days.KINDS
    assert share.TRACKER_KIND_LABELS == tracker_days.KIND_LABELS
    assert share.TRACKER_DAYS == trackers.DAYS_CHOICES
    assert share.S_UNIT_LONG == tracker_days.S_UNIT
    from api.services.journal_two import routines
    assert share.S_TOO_MANY_ITEMS == routines.S_TOO_MANY_ITEMS
    assert share.S_ITEM_LONG == routines.S_ITEM_LONG
    assert share.ITEMS_MAX == routines.ITEMS_CAP and share.ITEM_TEXT_MAX == routines.ITEM_MAX
    assert set(share.TYPE_LABELS) == set(share.SLOT_TYPES) and len(share.SLOT_TYPES) == 10


# -- the module reads no database ---------------------------------------------------------------

_BANNED = frozenset({"sqlite3", "db", "auth_db", "get_connection"})


def _db_reads(src: str) -> list[str]:
    """Every import naming a database module or `get_connection`, and every read of `user_id`."""
    found: list[str] = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            for a in node.names:
                if set(a.name.split(".")) & _BANNED:
                    found.append("import " + a.name)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if set(mod.split(".")) & _BANNED or any(a.name in _BANNED for a in node.names):
                found.append("from " + mod)
        elif isinstance(node, ast.Name) and node.id == "user_id":
            found.append("name user_id")
        elif isinstance(node, ast.arg) and node.arg == "user_id":
            found.append("arg user_id")
        elif isinstance(node, ast.Attribute) and node.attr == "user_id":
            found.append("attr user_id")
        elif isinstance(node, ast.Constant) and node.value == "user_id":
            found.append("str user_id")
    return found


def test_share_module_reads_no_database():
    src = pathlib.Path(share.__file__).read_text(encoding="utf-8")
    assert _db_reads(src) == []
    # non-vacuity: the walk sees share.py's real imports, and fires on a planted snippet
    tree = ast.parse(src)
    mods = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
    assert "api.services.journal_two.widget_engine" in mods or any("plan" in (m or "") for m in mods)
    planted = ("import sqlite3\nfrom api.services.auth_db import get_connection\n"
               "from api.services import db\ndef f(user_id):\n    return row['user_id']\n")
    assert len(_db_reads(planted)) == 5
