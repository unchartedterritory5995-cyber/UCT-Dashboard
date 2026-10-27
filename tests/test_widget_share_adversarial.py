"""Task 11.4 fix round 1: the adversarial review's cases (r114), ported as standing rails.

Each test asserts the SAFE behaviour; each was red against the round-0 reducer or is a control the
review found green. Every one is mutation-proved (task-11.4-report.md, fix round 1).
"""
from __future__ import annotations

import json

import pytest

from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as S

CAT = S.CATALOG
CANARY = "zzq-canary-7f3a"
NUM = 987654.321
FORBID = ("zzq", "canary-7f3a", "987654", "987,654", "9.87654321")
DEF_ID = "0a1b2c3d-1111-4222-8333-7f3a00000004"
R_ID = "0a1b2c3d-1111-4222-8333-7f3a00000001"
T_ID = "0a1b2c3d-1111-4222-8333-7f3a00000002"


@pytest.fixture(autouse=True)
def _kinds_offered(monkeypatch):
    monkeypatch.setitem(S._GATED_FIELDS, ("notes", "kind"), lambda: True)


def clean(payload):
    for blob in (json.dumps(payload), json.dumps(payload, ensure_ascii=False)):
        low = blob.lower()
        for bad in FORBID:
            assert bad not in low, f"{bad!r} leaked: {blob[:600]}"


def plan(**kw):
    p = {"v": 3, "source": "closed_trades", "measures": [{"key": "net_pnl"}]}
    p.update(kw)
    return p


def formula_plan(expr, name="mine"):
    return plan(formulas=[{"id": "f1", "name": name, "expr": expr, "format": "number"}],
                measures=[{"formula": "f1", "agg": "avg"}])


# -- 1. template block ids ------------------------------------------------------------------------

def test_t1_unknown_block_id_does_not_travel():
    """journal_styles._clean_blocks keeps an UNKNOWN block id verbatim ("a newer version's block"),
    so a member-chosen id like `zzq_canary_7f3a` can be stored. share_template copies any id that
    matches _BLOCK_RE."""
    style = {"blocks": [{"block": "zzq_canary_7f3a", "enabled": True, "settings": {"x": CANARY}},
                        {"block": "Zzqcanary7f3a", "enabled": True, "settings": {}}]}
    out = share.share_template(style, definitions={}, routines={}, trackers={}, catalog=CAT)
    clean(out.payload)


# -- 2. formula literals ---------------------------------------------------------------------------

@pytest.mark.parametrize("expr", [
    "[r] * 987654.321",
    "[r] * 0987654.321",
    "[r] * -987654.321",
    "[r] - --987654.321",
    "[r] * -  987654.321",
    "[r] * (987654.321)",
    "[r] * -(987654.321)",
    "Round([r] * 987654.321, 3)",
    "If([r] > 987654.321, 987654.321, 0.987654)",
])
def test_t2_formula_numbers_never_travel(expr):
    out = share.share_plan(formula_plan(expr), catalog=CAT)
    clean(out.payload)


@pytest.mark.parametrize("expr", [
    "[r] * -(2)",
    "[r] * -((2))",
    "[r] - -(2) + 1",
])
def test_t3_negated_parenthesised_literal_round_trips(expr):
    """A `neg` whose operand is a parenthesised number: the span runs from the minus to the end of
    the number and swallows `(` but not `)`, so the shared expression is unbalanced."""
    out = share.share_plan(formula_plan(expr), catalog=CAT)
    sh = out.payload["plan"]
    answers = {s["id"]: 3 for s in out.slots}
    resolved = share.resolve_plan(sh, out.payload["slots"], answers, catalog=CAT)
    assert resolved["formulas"][0]["expr"].count("(") == resolved["formulas"][0]["expr"].count(")")


@pytest.mark.parametrize("expr", [
    '[symbol] = "zzq-canary-7f3a"',
    '[setup] = "zzq-canary-7f3a"',
    '[side] = "zzq-canary-7f3a"',
    'If([r] > 0, "zzq-canary-7f3a", "b")',
    'Weekday([day]) = "zzq-canary-7f3a"',
    '"zzq-canary-7f3a" = "zzq-canary-7f3a"',
])
def test_t4_text_literal_refused(expr):
    p = plan(formulas=[{"id": "f1", "name": "mine", "expr": expr, "format": "number"}],
             measures=[{"key": "net_pnl"}],
             filters=[])
    try:
        out = share.share_plan(p, catalog=CAT)
    except share.ShareError as e:
        assert e.code in ("own_words", "invalid")
        return
    clean(out.payload)


def test_t4b_closed_text_literal_travels_and_is_closed():
    p = formula_plan('If([weekday] = "Monday", [r], 0)')
    out = share.share_plan(p, catalog=CAT)
    assert '"Monday"' in out.payload["plan"]["formulas"][0]["expr"]


# -- 3. display / view / sort / future keys --------------------------------------------------------

def test_t5_stop_after_number_needs_keep():
    """display.stopAfter is a number the member typed (1..20); it travels with no keep path."""
    p = {"v": 3, "source": "closed_trades", "measures": [{"key": "current_streak"}],
         "display": {"stopAfter": 17}}
    out = share.share_plan(p, catalog=CAT)
    assert "stopAfter" not in out.payload["plan"]["display"]
    kept = share.share_plan(p, catalog=CAT, keep=["display/stopAfter"])
    assert kept.payload["plan"]["display"]["stopAfter"] == 17 and kept.kept == ("display/stopAfter",)


def test_t6_future_display_key_fails_closed(monkeypatch):
    """A display key added to WAVE10_DISPLAY later (with the validator writing it) must not be
    copied by default: share.py copies every WAVE10_DISPLAY key verbatim."""
    monkeypatch.setattr(wplan, "WAVE10_DISPLAY", (*wplan.WAVE10_DISPLAY, "caption"))
    real = wplan._check_display_w10

    def w10(rd, display, plan_, catalog, compiled, formulas=()):
        real(rd, display, plan_, catalog, compiled, formulas)
        if "caption" in rd:
            display["caption"] = rd["caption"]
    monkeypatch.setattr(wplan, "_check_display_w10", w10)
    out = share.share_plan(plan(display={"caption": CANARY}), catalog=CAT)
    clean(out.payload)


def test_t7_future_text_field_fails_closed(monkeypatch):
    """A filterable text field the catalog adds later (not ci, no public_kind) is dropped."""
    import dataclasses
    fields = dict(CAT.sources["closed_trades"].fields)
    base = fields["setup"]
    fields["coach_note"] = dataclasses.replace(base, key="coach_note", label="Coach note",
                                               type="text", ci=False, public_kind=None)
    fields["broker_label"] = dataclasses.replace(base, key="broker_label", label="Broker label",
                                                 type="enum", choices=None, bucket=None,
                                                 public_kind=None)
    fields["weird"] = dataclasses.replace(base, key="weird", label="Weird", type="richtext",
                                          public_kind=None)
    src = dataclasses.replace(CAT.sources["closed_trades"], fields=fields)
    import types
    cat = types.SimpleNamespace(sources={**CAT.sources, "closed_trades": src}, measures=CAT.measures,
                                accents=CAT.accents, view_allowed=lambda p: None)
    p = plan(filters=[{"field": "coach_note", "op": "in", "values": [CANARY]},
                      {"field": "broker_label", "op": "in", "values": [CANARY]},
                      {"field": "weird", "op": "in", "values": [CANARY]}])
    out = share.share_plan(p, catalog=cat)
    clean(out.payload)
    assert out.payload["plan"]["filters"] == []


# -- 4. edits --------------------------------------------------------------------------------------

def test_t8_edits_cannot_smuggle_structure():
    out = share.share_plan(plan(), catalog=CAT, edits={
        "plan": {"filters": [{"field": "setup", "op": "in", "values": [CANARY]}]},
        "display": {"title": CANARY}, "slots": [CANARY], "formulas": {"f9": CANARY},
        "blocks": {"x": CANARY}, "items": [CANARY], "unit": CANARY})
    clean(out.payload)


def test_t9_edited_formula_name_that_collides_still_adoptable():
    """An edited formula name equal to a catalog field label passes share and is then refused by
    validate_plan for every adopter (S_FORMULA_NAME_TAKEN): the share should refuse up front."""
    p = formula_plan("[r] * 2")
    try:
        out = share.share_plan(p, catalog=CAT, edits={"formulas": {"f1": "Net P&L"}})
    except share.ShareError:
        return                                     # refused at share time: fine
    answers = {s["id"]: 2 for s in out.slots}
    share.resolve_plan(out.payload["plan"], out.payload["slots"], answers, catalog=CAT)


def test_t10_edited_formula_name_with_token_still_adoptable():
    p = formula_plan("[r] * 2")
    try:
        out = share.share_plan(p, catalog=CAT, edits={"formulas": {"f1": "Edge [#p1]"}})
    except share.ShareError:
        return
    answers = {s["id"]: 2 for s in out.slots}
    share.resolve_plan(out.payload["plan"], out.payload["slots"], answers, catalog=CAT)


def test_t11_template_edits_for_missing_blocks_ignored():
    style = {"blocks": [{"block": "tracker_1", "settings": {"ref": "tracker:" + T_ID}}]}
    out = share.share_template(style, definitions={}, routines={},
                               trackers={"tracker:" + T_ID: {"kind": "number", "name": CANARY}},
                               edits={"blocks": {"tracker_9": {"name": CANARY},
                                                 "built_z": {"name": CANARY}}}, catalog=CAT)
    clean(out.payload)


# -- 5. keep ---------------------------------------------------------------------------------------

def test_t12_keep_cannot_keep_text_or_structure():
    p = plan(filters=[{"field": "setup", "op": "in", "values": [CANARY]},
                      {"field": "symbol", "op": "in", "values": [CANARY]}],
             display={"title": CANARY, "titleAuto": False},
             formulas=[{"id": "f1", "name": CANARY, "expr": "[r] * 2", "format": "number"}])
    keep = ["filters/0/values/0", "filters/1/values/0", "display/title", "display/subtitle",
            "formulas/f1/0", "formulas/f1/name", "name", "accounts", "filters/0", "filters"]
    out = share.share_plan(p, catalog=CAT, keep=keep)
    clean(out.payload)
    assert out.kept == ()


def test_t13_keep_on_property_values():
    PROP = "7f3a" * 8
    p = {"v": 3, "source": "notes", "measures": [{"key": "notes"}],
         "filters": [{"field": "property", "prop": PROP, "op": "eq", "values": [NUM]}]}
    out = share.share_plan(p, catalog=CAT, keep=())
    clean(out.payload)


def test_t14_routine_keep_crafted_paths():
    r = {"items": [{"id": CANARY, "text": CANARY, "negative": True,
                    "suggest": {"rule": "max_trades", "n": 987654}}],
         "schedule": {"kind": "weekdays", "days": [987654, 1]},
         "settings": {"done_share": NUM}, "name": CANARY}
    out = share.share_routine(r, edits={"items": [{"text": "Plan", "suggest": {"n": 987654},
                                                   "id": CANARY}]},
                              keep=["items/0/suggest", "items/0/text", "name", "items/0/id"])
    clean(out.payload)


# -- 6. trackers / routines ------------------------------------------------------------------------

def test_t15_tracker_hostile_row():
    t = {"kind": "number", "name": CANARY, "unit": CANARY, "settings": {"days": CANARY},
         "value": NUM, "target": NUM, "range": [NUM, NUM]}
    clean(share.share_tracker(t, edits={"kindLabel": CANARY}).payload)


# -- 7. template refs the store would refuse (defence in depth) ------------------------------------

def test_t16_template_unvalidated_refs_do_not_travel():
    style = {"blocks": [
        {"block": "built_a", "settings": {"ref": "shelf:zzq-canary-7f3a", "defRev": 1}},
        {"block": "routine_a", "settings": {"template": "zzq_canary_7f3a"}},
    ]}
    out = share.share_template(style, definitions={}, routines={}, trackers={}, catalog=CAT)
    clean(out.payload)


# -- 8. teeth: does the rail notice a leak in places the planted reducer does not touch? ----------

def test_t17_canary_rail_catches_each_widget_plan_individually(monkeypatch):
    from tests import test_widget_share_canary as C
    import dataclasses
    real = share.share_plan

    def leaky(p, **kw):
        got = real(p, **kw)
        pl = dict(got.payload)
        pl["plan"] = {**pl["plan"], "filters": p.get("filters", [])}
        return dataclasses.replace(got, payload=pl)
    monkeypatch.setattr(share, "share_plan", leaky)
    caught = 0
    for p in C.widget_plans():
        try:
            C.assert_clean(share.share_plan(p, catalog=CAT).payload)
        except AssertionError:
            caught += 1
    assert caught == len(C.widget_plans())
