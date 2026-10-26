"""Task 11.4: the canary rail for the ONE sharing reducer (ruling W11-R1, W11-R6, Review Focus 1).

Every stored field of a widget, a routine, a tracker and a template carries the canary
`zzq-canary-7f3a` (also upper-cased, case-shifted, underscore-shaped as a stored block id can be,
and with a non-ASCII tail that `ensure_ascii` escapes) and the number `987654.321`. With empty `edits` and `keep`, neither `json.dumps(payload)` nor
`json.dumps(payload, ensure_ascii=False)` may contain the canary in any case, the number in any of
its three formats, or any planted id. `test_canary_rail_has_teeth` proves the helper goes red on a
reducer that copies stored values.
"""
from __future__ import annotations

import dataclasses
import json

import pytest

from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as S

CAT = S.CATALOG

CANARY = "zzq-canary-7f3a"
CANARY_UP = CANARY.upper()
CANARY_ESC = "zZQ-CANARY-7F3A"          # case-shifted (plain ASCII text at run time)
CANARY_NA = CANARY + "é中"     # a non-ASCII tail: ensure_ascii escapes only the tail
NUMBER = 987654.321
#: What must never appear, lower-cased. "canary-7f3a" also catches a copy whose first letters were
#: escaped or re-cased; the number is checked in its three formats (and its leading digits).
FORBIDDEN_TEXT = ("zzq-canary-7f3a", "canary-7f3a", "zzq")
FORBIDDEN_NUMBER = ("987654.321", "987,654.32", "9.87654321e5", "987654", "987,654", "9.87654321")

# Ids a member stored. Each is the shape its validator demands (uuid4, hex), with a recognisable tail.
ROUTINE_ID = "0a1b2c3d-1111-4222-8333-7f3a00000001"
TRACKER_ID = "0a1b2c3d-1111-4222-8333-7f3a00000002"
PROP_ID = "7f3a0000000000000000000000000003"
DEF_ID = "0a1b2c3d-1111-4222-8333-7f3a00000004"
ITEM_ID = "item-zzq-canary-7f3a"
FORBIDDEN_IDS = (ROUTINE_ID, TRACKER_ID, PROP_ID, DEF_ID, "7f3a0000")


def assert_clean(payload) -> None:
    """THE assertion: the canary in no case, the number in no format, no planted id."""
    for blob in (json.dumps(payload), json.dumps(payload, ensure_ascii=False)):
        low = blob.lower()
        for bad in FORBIDDEN_TEXT + FORBIDDEN_NUMBER + FORBIDDEN_IDS:
            assert bad.lower() not in low, f"{bad!r} survived the share: {blob[:400]}"


@pytest.fixture(autouse=True)
def _kinds_offered(monkeypatch):
    # "Kind of note" is offered behind the journal styles switch (W10-R62); the reducer is what is
    # under test here, so the field is offered for these plans.
    monkeypatch.setitem(S._GATED_FIELDS, ("notes", "kind"), lambda: True)


def widget_plans() -> list[dict]:
    """Plans whose every stored member value is the canary or the number (each a valid plan)."""
    closed = {
        "v": 3, "source": "closed_trades", "accounts": {"id": CANARY},
        "range": {"from": "2026-01-01", "to": "2026-03-31"},
        "filters": [
            {"field": "setup", "op": "in", "values": [CANARY, CANARY_UP]},
            {"field": "symbol", "op": "in", "values": [CANARY_ESC]},
            {"field": "mistake", "op": "has_any", "values": [CANARY]},
            {"field": "account", "op": "in", "values": [CANARY + " Fidelity"]},
            {"field": "net", "op": "gt", "values": [NUMBER]},
            {"field": "day", "op": "between", "values": ["2026-01-02", "2026-02-03"]},
            {"field": "formula:f1", "op": "gte", "values": [NUMBER]},
            {"field": "emotion", "op": "has_any", "values": [CANARY_ESC, CANARY_NA]},
        ],
        "measures": [{"formula": "f1", "agg": "avg"}, {"key": "net_pnl"}],
        "formulas": [{"id": "f1", "name": CANARY, "expr": "[r] * 987654.321 - -987654.321",
                      "format": "number"}],
        "compare": {"mode": "range", "from": "2025-01-01", "to": "2025-03-31"},
        "display": {"title": CANARY, "subtitle": CANARY_UP, "titleAuto": False, "target": NUMBER},
    }
    notes = {
        "v": 3, "source": "notes", "range": {"token": "last_90d"},
        "filters": [
            {"field": "folder", "op": "in", "values": [CANARY]},
            {"field": "tag", "op": "has_any", "values": [CANARY_UP]},
            {"field": "kind", "op": "in", "values": [CANARY_ESC]},
            {"field": "property", "prop": PROP_ID, "op": "eq", "values": [NUMBER]},
            {"field": "property", "prop": PROP_ID, "op": "eq", "values": [CANARY]},
            {"field": "ticker", "op": "contains", "values": [CANARY]},
            {"field": "month", "op": "in", "values": [CANARY]},
        ],
        "measures": [{"key": "property_sum", "prop": PROP_ID}],
        "split": {"by": "folder"},
        "display": {"title": CANARY_ESC},
    }
    days = {
        "v": 2, "source": "trading_days", "accounts": {"id": CANARY_UP},
        "filters": [
            {"field": "routine_done", "op": "in", "values": ["done"], "ref": ROUTINE_ID},
            {"field": "tracker_value", "op": "gte", "values": [NUMBER], "ref": TRACKER_ID},
            {"field": "mood", "op": "lte", "values": [NUMBER]},
        ],
        "measures": [{"key": "avg_day_pnl"}],
        "split": {"by": "routine_done", "ref": ROUTINE_ID},
        "view": {"type": "bar"},
    }
    routine_history = {
        "v": 2, "source": "routine_history",
        "filters": [{"field": "routine", "op": "in", "values": [ROUTINE_ID, CANARY]},
                    {"field": "consistency", "op": "between", "values": [NUMBER, NUMBER]}],
        "measures": [{"key": "routine_completion_pct"}],
    }
    tracker_history = {
        "v": 2, "source": "tracker_history",
        "filters": [{"field": "tracker", "op": "in", "values": [TRACKER_ID]},
                    {"field": "value", "op": "eq", "values": [NUMBER]}],
        "measures": [{"key": "tracker_avg"}],
    }
    return [closed, notes, days, routine_history, tracker_history]


def routine_row() -> dict:
    return {
        "id": ROUTINE_ID, "name": CANARY,
        "items": [{"id": ITEM_ID, "text": CANARY, "negative": True,
                   "suggest": {"rule": "max_trades", "n": 987654}},
                  {"id": ITEM_ID + "2", "text": CANARY_ESC, "negative": False,
                   "suggest": {"rule": CANARY}}],
        "schedule": {"kind": "weekdays", "days": [0, 2]},
        "settings": {"done_share": 0.75, "strict": True,
                     "reminder": {"on": True, "time_et": "09:35"}},
        "createdDay": "2026-01-02", "updatedAt": CANARY, "etag": 987654,
        "sourceTemplateKey": None, "usedIn": 987654,
    }


def tracker_row() -> dict:
    return {"id": TRACKER_ID, "name": CANARY_UP, "kind": "number", "unit": CANARY[:16],
            "settings": {"days": "any"}, "createdDay": "2026-01-02", "updatedAt": CANARY,
            "value": NUMBER, "lastValue": NUMBER, "etag": 987654, "sourceTemplateKey": None}


def definition_row() -> dict:
    return {"id": DEF_ID, "name": CANARY, "summary": CANARY_UP, "plan": widget_plans()[0],
            "rev": 987654, "lastAnswer": CANARY, "createdAt": CANARY}


def template_style() -> dict:
    return {
        "id": CANARY, "name": CANARY_UP, "kindId": CANARY, "properties": {PROP_ID: CANARY},
        "outlineBodyJson": {"type": "doc", "content": [{"type": "text", "text": CANARY}]},
        "blocks": [
            {"block": "built_a", "enabled": True,
             "settings": {"ref": "def:" + DEF_ID, "defRev": 987654, "range": {"token": "ytd"},
                          "note": CANARY}},
            {"block": "built_b", "enabled": True,
             "settings": {"ref": "def:" + DEF_ID, "defRev": 987654}},
            {"block": "routine_1", "enabled": True,
             "settings": {"ref": "routine:" + ROUTINE_ID, "bind": "week", "display": "items",
                          "extra": CANARY}},
            {"block": "tracker_1", "enabled": True,
             "settings": {"ref": "tracker:" + TRACKER_ID, "bind": "note-day", "display": "chart"}},
            {"block": "tracker_2", "enabled": True, "settings": {"ref": "checkin:mood"}},
            {"block": "chart", "enabled": True, "settings": {"tf": CANARY, "ticker": CANARY}},
            {"block": CANARY, "enabled": True, "settings": {}},
            # C1 (fix round 1): `_BLOCK_RE`-shaped ids, as the style store keeps an unknown id verbatim
            {"block": "zzq_canary_7f3a", "enabled": True, "settings": {"x": CANARY}},
            {"block": "ZZQ_CANARY_7F3A", "enabled": True, "settings": {}},
            {"block": "Zzqcanary7f3a", "enabled": True, "settings": {}},
        ],
    }


def share_widget_payloads() -> list[dict]:
    return [share.share_plan(p, catalog=CAT, edits={}, keep=()).payload for p in widget_plans()]


def share_routine_payload() -> dict:
    # A routine share needs the items the author picked; the preview prefills the stored text, so
    # an author who changes nothing still has to type: here they typed new words for one item.
    return share.share_routine(routine_row(), edits={"items": ["Check the plan"]}).payload


def share_tracker_payload() -> dict:
    return share.share_tracker(tracker_row(), edits={}).payload


def share_template_payload() -> dict:
    d = definition_row()
    return share.share_template(
        template_style(), definitions={"def:" + DEF_ID: d},
        routines={"routine:" + ROUTINE_ID: routine_row()},
        trackers={"tracker:" + TRACKER_ID: tracker_row()},
        edits={"blocks": {"routine_1": {"items": ["Check the plan"]}}}, keep=(), catalog=CAT).payload


def test_canary_never_survives_a_widget_share():
    payloads = share_widget_payloads()
    assert len(payloads) == 5
    for p in payloads:
        assert_clean(p)
    # non-vacuity: the payloads are real shares, with picks where the values were
    assert all(p["plan"]["measures"] for p in payloads)
    assert payloads[0]["slots"]


def test_canary_never_survives_a_routine_share():
    p = share_routine_payload()
    assert_clean(p)
    assert p["items"] == [{"text": "Check the plan", "negative": True,
                           "suggest": {"rule": "max_trades"}}]


def test_canary_never_survives_a_tracker_share():
    p = share_tracker_payload()
    assert_clean(p)
    assert p == {"name": "Number tracker", "kind": "number", "unit": None, "days": "any"}


def test_canary_never_survives_a_template_share():
    p = share_template_payload()
    assert_clean(p)
    assert p["format"] == 2
    assert len(p["definitions"]) == 1 and len(p["routines"]) == 1 and len(p["trackers"]) == 1


def test_only_edited_text_and_kept_numbers_travel():
    plan = widget_plans()[0]
    kept_path = "filters/4/values/0"         # the Net P&L threshold
    out = share.share_plan(plan, catalog=CAT, edits={"name": CANARY}, keep=[kept_path])
    blob = json.dumps(out.payload)
    assert blob.lower().count(CANARY) == 1 and out.payload["name"] == CANARY
    assert blob.count("987654.321") == 1
    net = [f for f in out.payload["plan"]["filters"] if f["field"] == "net"]
    assert net == [{"field": "net", "op": "gt", "overridable": False, "values": [NUMBER]}]
    assert out.kept == (kept_path,)
    # nothing else: removing the two allowed copies leaves a clean payload
    stripped = json.loads(blob.replace(CANARY, "name").replace("987654.321", "1.5"))
    assert_clean(stripped)


def _leaky_plan(real, part):
    """A `share_plan` that copies one stored part of the plan into the shared plan."""
    def leaky(plan, *, catalog, edits=None, keep=(), slot_start=1, **kw):
        got = real(plan, catalog=catalog, edits=edits, keep=keep, slot_start=slot_start, **kw)
        shared = dict(got.payload["plan"])
        if part in plan:
            shared[part] = plan[part]
        return dataclasses.replace(got, payload={**got.payload, "plan": shared})
    return leaky


def _leaky_payload(real, key, stored_key):
    """A routine or tracker reducer that copies one stored field into its payload."""
    def leaky(row, *, edits=None, **kw):
        got = real(row, edits=edits, **kw)
        return dataclasses.replace(got, payload={**got.payload, key: row[stored_key]})
    return leaky


def _plant(monkeypatch, defect):
    if defect in ("filters", "formulas", "display", "accounts"):
        monkeypatch.setattr(share, "share_plan", _leaky_plan(share.share_plan, defect))
    elif defect == "routine_items":
        monkeypatch.setattr(share, "share_routine", _leaky_payload(share.share_routine, "items", "items"))
    elif defect == "routine_name":
        monkeypatch.setattr(share, "share_routine", _leaky_payload(share.share_routine, "name", "name"))
    elif defect == "tracker_name":
        monkeypatch.setattr(share, "share_tracker", _leaky_payload(share.share_tracker, "name", "name"))
    elif defect == "tracker_unit":
        monkeypatch.setattr(share, "share_tracker", _leaky_payload(share.share_tracker, "unit", "unit"))
    elif defect == "block_ids":                  # C1 re-planted: every block id is "known"
        monkeypatch.setattr(share, "_known_block", lambda bid: True)
    else:
        raise AssertionError(defect)


def _payloads(kind):
    if kind == "widget":
        return [(f"plan {i}", p) for i, p in enumerate(share_widget_payloads())]
    if kind == "routine":
        return [("routine", share_routine_payload())]
    if kind == "tracker":
        return [("tracker", share_tracker_payload())]
    return [("template", share_template_payload())]


#: (kind, planted defect, the payloads that must go red; None = every payload of that kind)
TEETH = [
    ("widget", "filters", (0, 1, 2, 3, 4)),
    ("widget", "formulas", (0,)),
    ("widget", "display", (0, 1)),
    ("widget", "accounts", (0, 2)),
    ("template", "filters", None), ("template", "formulas", None), ("template", "display", None),
    ("template", "routine_items", None), ("template", "tracker_name", None),
    ("template", "block_ids", None),
    ("routine", "routine_items", None), ("routine", "routine_name", None),
    ("tracker", "tracker_name", None), ("tracker", "tracker_unit", None),
]


@pytest.mark.parametrize("kind,defect,which", TEETH, ids=[f"{k}-{d}" for k, d, _ in TEETH])
def test_canary_rail_has_teeth(monkeypatch, kind, defect, which):
    """Each planted defect (a reducer copying one stored part) makes the SAME helper red, on EACH
    payload named, one at a time (fix round 1, M4): a rail that catches a defect on one payload out
    of five proves nothing about the other four."""
    _plant(monkeypatch, defect)
    payloads = _payloads(kind)
    chosen = payloads if which is None else [payloads[i] for i in which]
    for _label, p in chosen:
        with pytest.raises(AssertionError):
            assert_clean(p)
