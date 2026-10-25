"""Task 10.9 -- the definitions router's wave 10 gate, the formula catalog and the vocabulary.

`require_paid` is never overridden here, only what it reads. The store and the engine are real, on
a temp sqlite file seeded through `auth_db.init_db` (the Task 8.5 fixtures in
`tests.test_widget_sources`); nothing here reaches `C:\\data`.

What it pins:
  * with wave 10 off, every plan `plan.uses_wave10` answers the dark 404 at run, preview, drill,
    create, save and revision restore; a rename-only PUT passes (W9-R16);
  * the vocabulary lists no wave 10 source, field, function, format, limit or display option while
    wave 10 is off, and all of them while it is on, each derived from its owner (never restated);
  * a formula refusal is 400 `formula` with `formulaId` and `pos` beside the message;
  * `?field=property` lists only the member's own user-set properties, each with its real type;
  * every wave 10 answer, 200 or error, is `no-store`;
  * the examples batch drops a card whose every revision needs wave 10 while it is off;
  * `quadrants: "excursion"` only on the excursion pair (10.18 m6);
  * the vectors' `plan_sentences` equal plan.py's constants (W10-R53).
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.notebook_widget_definitions as wdr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.journal_two import note_properties
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import widget_definitions as wdefs
from api.services.journal_two import widget_formula as wf
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import run as wrun
from api.services.journal_two.widget_engine import shelf as wshelf
from api.services.journal_two.widget_engine import sources as wsources
from tests.test_widget_notes_source import add_folder, add_kind, add_n, add_prop
from tests.test_widget_options_source import add_opt
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    UID, add_trade, add_user, conn, raw_plan,
)

OTHER = "u-w10r-other"
PAID = {"id": UID, "email": "paid@example.test", "role": "member", "plan": "pro"}
BASE = "/api/j2/widget-definitions"
VECTORS = Path(__file__).resolve().parent / "fixtures" / "widgetFormulaVectors.json"
W10_ENV = "NOTEBOOK_WIDGETS_W10_ENABLED"

#: The fields `?field=` lists only while wave 10 is on (the brief's names).
W10_VOCAB_FIELDS = ("underlying", "strategy", "folder", "kind", "note_tag", "ticker", "property")
#: The catalog keys only wave 10 adds (the brief's names).
#: The catalog's keys with wave 10 off: be's five plus impl's wave 8 keys (Task 8.15: the engine's reasons and view
#: rules, the time fields and the limits), merged at the be->impl merge.
BASE_CATALOG_KEYS = {"sources", "measures", "views", "ranges", "accents", "timeFields", "reasons", "viewRules",
                     "maxMeasures", "maxFilters", "topMax"}
W10_CATALOG_KEYS = {"functions", "formulaLimits", "formats", "displayOptions"}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    from api.limiter import limiter
    limiter.reset()
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-w10r-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    wrun._reset_state()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W8_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")          # production: W9 on, W10 off
    monkeypatch.delenv(W10_ENV, raising=False)
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")       # W10-R62: kinds offered
    yield
    wrun._reset_state()
    limiter.reset()


def _client(user=PAID):
    app = FastAPI()
    app.include_router(wdr.router)
    app.dependency_overrides[get_current_user] = lambda: dict(user)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def _on(monkeypatch, on: bool = True):
    monkeypatch.setenv(W10_ENV, "1" if on else "0")


def _plan(**kw):
    return raw_plan(range={"token": "last_30d"}, **kw)


def _f(fid, name, expr, fmt="number"):
    return {"id": fid, "name": name, "expr": expr, "format": fmt}


def _excursion(**kw):
    """The shelf's MAE vs MFE shape: |MAE| across, MFE up, both in R."""
    p = _plan(formulas=[_f("f1", "MAE", "Abs([mae_r])", "r"), _f("f2", "MFE", "[mfe_r]", "r")],
              view={"type": "scatter"}, display={"quadrants": "excursion"})
    p["measures"] = [{"formula": "f1", "agg": "avg"}, {"formula": "f2", "agg": "avg"}]
    p.update(kw)
    return p


def _w10_plans() -> dict:
    """A formula plan, an options plan, a notes plan and each wave 10 display option."""
    formula = _plan(formulas=[_f("f1", "Double", "[net] * 2")])
    formula["measures"] = [{"formula": "f1", "agg": "sum"}]
    return {
        "formula": formula,
        "options": raw_plan(source="options_strategies", measures=("strategies",),
                            range={"token": "last_30d"}),
        "notes": raw_plan(source="notes", measures=("notes",), range={"token": "last_30d"}),
        "cumulative": _plan(split={"by": "day"}, view={"type": "line"},
                            display={"cumulative": True}),
        "targetGoal": raw_plan(range={"token": "this_week"}, view={"type": "progress"},
                               display={"targetGoal": True}),
        "stopAfter": _plan(measures=("current_streak",), display={"stopAfter": 2}),
        "quadrants": _excursion(),
    }


def _no_store(r) -> bool:
    return "no-store" in r.headers.get("cache-control", "")


# -- the gate --------------------------------------------------------------------------------------

def test_wave10_plans_404_everywhere_when_off(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    c = _client()
    plans = _w10_plans()
    assert set(plans) >= {"formula", "options", "notes", *wplan.WAVE10_DISPLAY}
    # each is a wave 10 plan the validator accepts once the flag is on (non-vacuity)
    _on(monkeypatch)
    made = {}
    for name, p in plans.items():
        assert wplan.uses_wave10(p), name
        r = c.post(BASE, json={"plan": p})
        assert r.status_code == 200 and r.json()["plan"]["v"] == 3, (name, r.text[:300])
        w = r.json()
        plain = c.put(f"{BASE}/{w['id']}", json={"plan": _plan(), "apply": "only"},
                      headers={"If-Match": str(w["etag"])})
        assert plain.status_code == 200, (name, plain.text[:300])
        made[name] = plain.json()
    stored = conn.execute("SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?",
                          (UID,)).fetchone()[0]
    saved = wdefs.create(UID, "Plain", _plan())
    _on(monkeypatch, False)
    for name, p in plans.items():
        doors = {
            "run": c.post(BASE + "/run", json={"def": p}),
            "preview": c.post(BASE + "/preview", json={"plan": p}),
            "drill": c.post(BASE + "/drill", json={"def": p, "cell": {}}),
            "create": c.post(BASE, json={"plan": p}),
            "save": c.put(f"{BASE}/{saved['id']}", json={"plan": p, "apply": "only"},
                          headers={"If-Match": str(saved["etag"])}),
            "restore": c.post(f"{BASE}/{made[name]['id']}/revs/1/restore",
                              headers={"If-Match": str(made[name]["etag"])}),
        }
        for door, r in doors.items():
            assert r.status_code == 404, (name, door, r.status_code, r.text[:200])
            assert r.json()["detail"] == public.not_found().detail, (name, door)
            assert _no_store(r), (name, door)
    # nothing new was stored, and the saved plain widget kept its plain plan
    assert conn.execute("SELECT COUNT(*) FROM j2_widget_definitions WHERE user_id = ?",
                        (UID,)).fetchone()[0] == stored + 1
    assert wdefs.get(UID, saved["id"])["plan"]["v"] == 1
    # controls: a plain plan runs at every door with wave 10 off
    assert c.post(BASE + "/run", json={"def": _plan()}).status_code == 200
    assert c.post(BASE + "/preview", json={"plan": _plan()}).status_code == 200
    assert c.post(BASE + "/drill", json={"def": _plan(), "cell": {}}).status_code == 200
    # and the stored v3 revisions are kept: on again, each restores
    _on(monkeypatch)
    for name, w in made.items():
        r = c.post(f"{BASE}/{w['id']}/revs/1/restore", headers={"If-Match": str(w["etag"])})
        assert r.status_code == 200 and r.json()["plan"]["v"] == 3, (name, r.text[:200])


def test_rename_only_put_allowed_when_off(conn, monkeypatch):
    c = _client()
    _on(monkeypatch)
    w = c.post(BASE, json={"plan": _w10_plans()["formula"]}).json()
    _on(monkeypatch, False)
    r = c.put(f"{BASE}/{w['id']}", json={"name": "Renamed", "apply": "only"},
              headers={"If-Match": str(w["etag"])})
    assert r.status_code == 200, r.text[:200]
    assert r.json()["name"] == "Renamed" and r.json()["plan"]["v"] == 3     # the plan is kept
    # control: the same PUT carrying the plan is the dark 404
    again = c.put(f"{BASE}/{w['id']}", json={"name": "X", "plan": _w10_plans()["formula"],
                                             "apply": "only"},
                  headers={"If-Match": str(r.json()["etag"])})
    assert again.status_code == 404


# -- the vocabulary --------------------------------------------------------------------------------

def _fields(body, source):
    return {f["key"]: f for s in body["sources"] if s["key"] == source for f in s["fields"]}


def test_vocabulary_hides_wave10_when_off_and_lists_it_when_on(conn, monkeypatch):
    c = _client()
    off = c.get(BASE + "/vocabulary")
    assert off.status_code == 200 and _no_store(off)
    body = off.json()
    # impl's catalog keys (wave 8: reasons, view rules, limits) are there whatever wave 10 says
    assert set(body) == BASE_CATALOG_KEYS
    keys = {s["key"] for s in body["sources"]}
    assert not keys & wplan.WAVE10_SOURCES and "closed_trades" in keys
    assert "strategies" not in {m["key"] for m in body["measures"]}
    assert "notes" not in {m["key"] for m in body["measures"]}
    for s in body["sources"]:
        for f in s["fields"]:
            # `needsTimes` is impl's wave 8 field-row key (served whatever wave 10 says); hourKey and prop are wave 10's
            assert not {"hourKey", "prop"} & set(f), (s["key"], f["key"])
    for field in W10_VOCAB_FIELDS:
        r = c.get(BASE + "/vocabulary", params={"field": field})
        assert r.status_code == 400 and r.json()["detail"]["message"] == wdr.S_VOCAB_FIELD, field
        assert _no_store(r)

    _on(monkeypatch)
    on = c.get(BASE + "/vocabulary")
    assert on.status_code == 200 and _no_store(on)
    body = on.json()
    assert set(body) == BASE_CATALOG_KEYS | W10_CATALOG_KEYS
    assert wplan.WAVE10_SOURCES <= {s["key"] for s in body["sources"]}
    # each field row gains `hourKey` when the source sets one, `needsTimes` when it needs times
    ct = _fields(body, "closed_trades")
    assert ct["day"]["hourKey"] == "hour_et" and ct["hold_minutes"]["needsTimes"] is True
    assert "hourKey" not in ct["net"] and "needsTimes" not in ct["net"]
    notes = _fields(body, "notes")
    assert notes["created"]["hourKey"] == wsources.CATALOG.sources["notes"].fields["created"].hour_key
    assert notes["property"]["prop"] is True and notes["property"]["type"] is None
    assert sum(f.get("prop") is True for s in body["sources"] for f in s["fields"]) == 1
    for s in body["sources"]:                       # derived, never restated: every row agrees
        src = wsources.CATALOG.sources[s["key"]]
        for f in s["fields"]:
            fld = src.fields[f["key"]]
            assert f.get("hourKey") == fld.hour_key, (s["key"], f["key"])
            assert f.get("needsTimes", False) is fld.needs_times, (s["key"], f["key"])
    # the formula catalog, each from its owner
    assert body["functions"] == [dict(d) for d in wf.FUNCTION_DOCS]
    assert body["formulaLimits"] == {"length": wf.MAX_LENGTH, "tokens": wf.MAX_TOKENS,
                                     "depth": wf.MAX_DEPTH, "count": wf.MAX_FORMULAS,
                                     "name": wf.NAME_MAX}
    assert body["formulaLimits"] == {"length": 2000, "tokens": 500, "depth": 32, "count": 5,
                                     "name": 60}
    # formats: the shape the builder reads (`[{key, label}]`, builderCatalog.indexCatalog)
    assert [f["key"] for f in body["formats"]] == list(wplan.FORMULA_FORMATS)
    assert body["formats"] == [{"key": "number", "label": "Number"},
                               {"key": "money", "label": "Money"},
                               {"key": "percent", "label": "Percent"},
                               {"key": "r", "label": "R"}]
    assert body["displayOptions"] == list(wplan.WAVE10_DISPLAY)
    for field in W10_VOCAB_FIELDS:
        r = c.get(BASE + "/vocabulary", params={"field": field})
        assert r.status_code == 200 and r.json()["field"] == field, (field, r.text[:200])
        assert _no_store(r)
    # switched back off: hidden again (read per request)
    _on(monkeypatch, False)
    assert set(c.get(BASE + "/vocabulary").json()) == BASE_CATALOG_KEYS


def test_wave10_member_values_are_the_members(conn, monkeypatch):
    """`?field=` for the wave 10 fields: the member's own values, never another member's; trashed,
    archived and sample notes give none (the notes the notes widget reads, W10-R59)."""
    add_user(conn, OTHER)
    _on(monkeypatch)
    add_opt(conn, UID, underlying="SPY", strategy_type="iron_condor")
    add_opt(conn, UID, underlying="qqq", strategy_type="long_call")
    add_opt(conn, OTHER, underlying="TSLA", strategy_type="short_put")
    mine = add_folder(conn, UID, "Swing")
    add_folder(conn, OTHER, "Theirs")
    kid = add_kind(conn, UID, "Recap")
    add_kind(conn, OTHER, "Their kind")
    add_n(conn, UID, tags=["setup/flag", "earnings"], ticker="NVDA", folder=mine)
    add_n(conn, UID, tags=["gone"], ticker="AMD", deleted="2026-10-21T00:00:00Z")
    add_n(conn, UID, tags=["example"], ticker="AAPL", import_source="sample")
    add_n(conn, UID, tags=["shelved"], ticker="META", archived="2026-10-21T00:00:00Z")   # W10-R59
    add_n(conn, OTHER, tags=["secret"], ticker="MSFT")
    c = _client()

    def vals(field):
        r = c.get(BASE + "/vocabulary", params={"field": field})
        assert r.status_code == 200, (field, r.text[:200])
        return r.json()["values"]

    assert vals("underlying") == ["qqq", "SPY"]
    strat = vals("strategy")
    fmt = wsources.CATALOG.sources["options_strategies"].fields["strategy"].fmt
    assert strat == [{"value": "iron_condor", "label": fmt("iron_condor")},
                     {"value": "long_call", "label": fmt("long_call")}]
    assert vals("folder") == [{"id": mine, "name": "Swing"}]
    kinds = vals("kind")
    assert {"id": kid, "name": "Recap"} in kinds and "Their kind" not in {k["name"] for k in kinds}
    assert {"id": "trade_plan", "name": "Trade plan"} in kinds          # the built-in kinds too
    assert vals("note_tag") == ["earnings", "setup/flag"]
    assert vals("ticker") == ["NVDA"]


def test_property_vocabulary_owned_only(conn, monkeypatch):
    add_user(conn, OTHER)
    _on(monkeypatch)
    conviction = add_prop(conn, UID, "Conviction", "number")
    stage = note_properties.create_property_def(UID, "Stage", "select", options=[{"label": "A"}],
                                                conn=conn)["id"]
    gone = add_prop(conn, UID, "Old", "text")
    note_properties.delete_property_def(UID, gone, conn=conn)
    add_prop(conn, OTHER, "Their secret", "number")
    r = _client().get(BASE + "/vocabulary", params={"field": "property"})
    assert r.status_code == 200 and _no_store(r)
    got = r.json()["values"]
    assert sorted(got, key=lambda v: v["name"]) == [
        {"id": conviction, "name": "Conviction", "type": "number"},
        {"id": stage, "name": "Stage", "type": "select"},
    ]
    # each listed id is one the notes scan reads as the member's own (the scan's own authority)
    for v in got:
        assert wsources.member_property(conn, UID, v["id"]) is not None
    # no built-in property (`builtin:*`), whatever the member has
    assert not any(note_properties.is_builtin_property_id(v["id"]) for v in got)


# -- the formula refusal ------------------------------------------------------------------------

def test_formula_error_code_formula_with_id_and_pos(conn, monkeypatch):
    _on(monkeypatch)
    c = _client()
    saved = wdefs.create(UID, "Plain", _plan())
    bad = _plan(formulas=[_f("f1", "Fine", "[net]"), _f("f2", "Broken", "[net] +")])
    bad["measures"] = [{"formula": "f1", "agg": "sum"}]
    with pytest.raises(wf.FormulaError) as e:
        wplan.validate_plan(copy.deepcopy(bad), wsources.CATALOG)
    want = {"code": "formula", "message": e.value.sentence, "formulaId": "f2", "pos": e.value.pos}
    assert isinstance(e.value.pos, int) and e.value.formula_id == "f2"
    for door, r in (
            ("preview", c.post(BASE + "/preview", json={"plan": bad})),
            ("run", c.post(BASE + "/run", json={"def": bad})),
            ("create", c.post(BASE, json={"plan": bad})),
            ("save", c.put(f"{BASE}/{saved['id']}", json={"plan": bad, "apply": "only"},
                           headers={"If-Match": str(saved["etag"])}))):
        assert r.status_code == 400, (door, r.text[:200])
        assert r.json()["detail"] == want, door
        assert _no_store(r), door
    # control: a plan-level refusal stays `invalid`, with no formula keys
    r = c.post(BASE + "/preview", json={"plan": _plan(view={"type": "nope"})})
    assert r.status_code == 400 and r.json()["detail"] == {"code": "invalid",
                                                           "message": wplan.S_UNKNOWN_VIEW}
    # a formula name refusal is a PlanError, not a FormulaError: `invalid` too
    taken = _plan(formulas=[_f("f1", "Net P&L", "[net]")])
    taken["measures"] = [{"formula": "f1", "agg": "sum"}]
    r = c.post(BASE + "/preview", json={"plan": taken})
    assert r.json()["detail"] == {"code": "invalid", "message": wplan.S_FORMULA_NAME_TAKEN}


def test_every_wave10_response_no_store(conn, monkeypatch):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    c = _client()
    plans = _w10_plans()
    for on in (True, False):
        _on(monkeypatch, on)
        saved = wdefs.create(UID, "Plain", _plan())
        seen = set()
        for name, p in plans.items():
            for r in (c.post(BASE + "/run", json={"def": p}),
                      c.post(BASE + "/preview", json={"plan": p}),
                      c.post(BASE + "/drill", json={"def": p, "cell": {}}),
                      c.post(BASE, json={"plan": p}),
                      c.put(f"{BASE}/{saved['id']}", json={"plan": p, "apply": "only"},
                            headers={"If-Match": "999"})):
                seen.add(r.status_code)
                assert _no_store(r), (on, name, r.status_code, r.text[:200])
        for r in (c.get(BASE + "/vocabulary"), c.get(BASE + "/shelf"),
                  c.get(BASE + "/vocabulary", params={"field": "property"}),
                  c.post(BASE + "/examples", json={"ids": ["shelf:mae-vs-mfe"]})):
            seen.add(r.status_code)
            assert _no_store(r), (on, r.status_code)
        assert 200 in seen and (404 in seen if not on else 409 in seen), (on, seen)


def test_examples_skip_wave10_cards_when_off(conn, monkeypatch):
    """With wave 10 off, a card whose every revision needs wave 10 is dropped from the batch (the
    gallery draws its bare shape), never a 404 for the whole batch; a revised id runs revision 1."""
    c = _client()
    new = "shelf:mae-vs-mfe"
    assert wshelf.known(new) and wshelf.example(new, allowed=lambda p: not wplan.uses_wave10(p)) is None
    r = c.post(BASE + "/examples", json={"ids": ["shelf:win-rate", new, "shelf:equity-curve"]})
    assert r.status_code == 200 and _no_store(r), r.text[:300]
    cards = r.json()["cards"]
    assert set(cards) == {"shelf:win-rate", "shelf:equity-curve"}
    assert cards["shelf:equity-curve"]["def"] == wshelf.revision("shelf:equity-curve", 1)["plan"]
    alone = c.post(BASE + "/examples", json={"ids": [new]})
    assert alone.status_code == 200 and alone.json()["cards"] == {}
    # an id no shelf knows is still refused (never silently dropped)
    r = c.post(BASE + "/examples", json={"ids": ["shelf:nope"]})
    assert r.status_code == 400
    # on: the card runs
    _on(monkeypatch)
    r = c.post(BASE + "/examples", json={"ids": ["shelf:win-rate", new]})
    assert r.status_code == 200 and set(r.json()["cards"]) == {"shelf:win-rate", new}


# -- quadrants only on the excursion pair (10.18 m6) -------------------------------------------

def test_quadrants_only_on_the_excursion_pair():
    cat = wsources.CATALOG
    ok = wplan.validate_plan(_excursion(), cat)
    assert ok["display"]["quadrants"] == "excursion"
    shelf_plan = wshelf.revision("shelf:mae-vs-mfe", 1)["plan"]
    assert wplan.validate_plan(copy.deepcopy(shelf_plan), cat)["display"]["quadrants"] == "excursion"
    spaced = _excursion(formulas=[_f("f1", "MAE", " abs( [MAE R] ) ", "r"),
                                  _f("f2", "MFE", "[MFE R]", "r")])
    assert wplan.validate_plan(spaced, cat)["display"]["quadrants"] == "excursion"
    swapped = _excursion()
    swapped["measures"] = swapped["measures"][::-1]
    bad = {
        "raw MAE": _excursion(formulas=[_f("f1", "MAE", "[mae_r]", "r"),
                                        _f("f2", "MFE", "[mfe_r]", "r")]),
        "swapped axes": swapped,
        "not in R": _excursion(formulas=[_f("f1", "MAE", "Abs([mae_r])", "number"),
                                         _f("f2", "MFE", "[mfe_r]", "r")]),
        "catalog measures": _plan(measures=("total_r", "net_pnl"), view={"type": "scatter"},
                                  display={"quadrants": "excursion"}),
        "one measure": _excursion(measures=[{"formula": "f1", "agg": "avg"}]),
        "other formula": _excursion(formulas=[_f("f1", "MAE", "Abs([mae_r]) * 2", "r"),
                                              _f("f2", "MFE", "[mfe_r]", "r")]),
    }
    for name, raw in bad.items():
        with pytest.raises(wplan.PlanError) as e:
            wplan.validate_plan(copy.deepcopy(raw), cat)
        assert e.value.sentence == wplan.S_QUADRANTS_PAIR, (name, e.value.sentence)
    # the view rule keeps its own sentence, and comes first
    with pytest.raises(wplan.PlanError) as e:
        wplan.validate_plan(_excursion(view={"type": "number"}), cat)
    assert e.value.sentence == wplan.S_QUADRANTS
    # controls: the same shapes with no quadrants validate
    for name, raw in bad.items():
        raw = copy.deepcopy(raw)
        raw["display"].pop("quadrants")
        if name != "one measure":
            assert wplan.validate_plan(raw, cat)["view"]["type"] == "scatter", name


def test_quadrants_pair_refusal_at_the_router(conn, monkeypatch):
    _on(monkeypatch)
    raw_mae = _excursion(formulas=[_f("f1", "MAE", "[mae_r]", "r"), _f("f2", "MFE", "[mfe_r]", "r")])
    r = _client().post(BASE + "/preview", json={"plan": raw_mae})
    assert r.status_code == 400 and r.json()["detail"] == {"code": "invalid",
                                                           "message": wplan.S_QUADRANTS_PAIR}
    assert _client().post(BASE + "/preview", json={"plan": _excursion()}).status_code == 200


# -- W10-R53: the sentences the builder copies ----------------------------------------------------

def test_plan_sentences_in_the_vectors_are_plan_py_constants():
    doc = json.loads(VECTORS.read_text(encoding="utf-8"))
    sentences = doc["plan_sentences"]
    assert len(sentences) >= 5                                         # non-vacuity
    assert {"S_FORMULA_NAME", "S_FORMULA_NAME_LONG", "S_FORMULA_NAME_TAKEN", "S_BAD_CHARACTER",
            "S_GOAL_SOURCE", "S_QUADRANTS_PAIR"} <= set(sentences)
    for name, text in sentences.items():
        assert name.startswith("S_") and getattr(wplan, name) == text, name
