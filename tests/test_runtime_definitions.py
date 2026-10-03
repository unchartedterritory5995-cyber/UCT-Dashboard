"""RT1 (2026-10-02) — the store's door for a RUNTIME-LANE definition.

Rails for `api/services/runtime_definitions.py` and its wiring:

* the save door is OFF by default and says so; ON, a runtime document is stored
  under a `runtime:sha256:` handle with the repaint verdict re-derived here;
* the per-script KILL SWITCH refuses a save, stamps a SERVED row, and never
  touches a STORED one (memory rule: a kill switch is never a delete);
* nothing downstream that needs a tree — the nightly sweep, the relint pass,
  the alert lane — ever admits a runtime row;
* RT2: the server STATES the repaint class (``runtime_repaint``, held to the
  client door's answer per corpus script by ``tests/test_runtime_repaint.py``) and
  refuses a document whose declared class or forward window disagrees with it.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
MEMBER_PANE_JS = (ROOT / "app" / "src" / "components" / "chart" / "builder" / "memberPane"
                  / "memberPaneDefinition.js")
USER = "u-rt1"
DEF_ID = "u_0000000000a1"
SOURCE = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s, title="Sum")\n'


def runtime_defn(source: str = SOURCE, def_id: str = DEF_ID) -> dict:
    """A runtime document shaped as `memberPaneDefinition::runtimeLaneDefinition`
    mints one."""
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": "t", "shortName": "t", "repaint": "non-repainting", "lane": "runtime",
                 "runtimeHistory": "listing"},
        "compute": {"kind": "runtime", "fn": f"runtime:{def_id}", "rev": 1,
                    "source": source, "outputs": {"value": 0}},
        "placement": {"target": "pane", "pane": {"height": 0.25}},
        "plots": [{"key": "value", "style": "line", "role": "primary", "label": "Sum"}],
        "inputs": [],
    }


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    # ⛔ the alert DB the relint pass reads, moved like `test_user_definitions.py`'s
    # `store` fixture moves it (the attribute, not only the env var)
    from api.services import alert_rev_migration as rev
    from api.services import indicator_alert_service as ias
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    monkeypatch.delenv(rt.SAVE_ENV, raising=False)
    monkeypatch.delenv(rt.KILL_ENV, raising=False)
    monkeypatch.delenv(rt.ALLOW_ENV, raising=False)
    # ⭐ GT — the rails here are about the save door's SHAPE checks, so the two
    # doors GT put in front of it are opened: the stage for everyone, and the
    # starter allowlist answered "graded" for these synthetic sources.
    # `test_pine_runtime_switch_on.py` rails both doors themselves.
    monkeypatch.setenv(rt.STAGE_ENV, rt.STAGE_ALL)
    monkeypatch.setattr(rt, "not_graded", lambda source: None)
    return tmp_path


@pytest.fixture
def client(store):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    return TestClient(app)


# ─── the save door ───────────────────────────────────────────────────────────

def test_OFF_by_default_the_store_refuses_a_runtime_document_with_a_sentence(store):
    with pytest.raises(ValueError, match=r"switched off \(PINE_RUNTIME_SAVE_ENABLED\)"):
        svc.save(USER, DEF_ID, runtime_defn())
    assert svc.get(USER, DEF_ID) is None  # nothing was written


def test_ON_a_runtime_document_is_stored_under_a_runtime_handle(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    row = svc.save(USER, DEF_ID, runtime_defn())
    assert row["appended"] is True and row["version"] == 1 and row["rev"] == 1
    assert row["ast_hash"] == rt.HASH_PREFIX + rt.source_hash(SOURCE)
    assert row["repaint"] == {"value": "non-repainting"}
    stored = svc.get(USER, DEF_ID)
    assert stored["definition"]["compute"]["source"] == SOURCE
    # a byte-identical re-save appends nothing
    again = svc.save(USER, DEF_ID, runtime_defn())
    assert again["appended"] is False and again["version"] == 1
    # an edit to the SOURCE bumps the rev
    edited = svc.save(USER, DEF_ID, runtime_defn(SOURCE + "// edited\n"))
    assert edited["version"] == 2 and edited["rev_bumped"] is True and edited["rev"] == 2


@pytest.mark.parametrize("mutate, message", [
    (lambda d: d["compute"].update(source="   "), r"compute\.source"),
    (lambda d: d["compute"].update(outputs={}), r"compute\.outputs"),
    (lambda d: d["compute"].update(outputs={"value": -1}), r"integer >= 0"),
    (lambda d: d["compute"].update(ast={"type": "num", "value": 0}), r"compute\.ast: only an \"ast\""),
    (lambda d: d["compute"].update(outputs={"nope": 0}), r"names no plot"),
    (lambda d: d["compute"].update(source=SOURCE + 'x = "never closed\n'),
     r"could not be read to state its repaint behaviour"),
    # ⭐ RT2 — a declared class the source does not measure, in BOTH directions
    (lambda d: d["meta"].update(repaint="repaints"),
     r"meta\.repaint — declared 'repaints' but this script measures 'non-repainting'"),
    (lambda d: d["compute"].update(source=SOURCE + "plot(barstate.islast ? close : na)\n"),
     r"meta\.repaint — declared 'non-repainting' but this script measures 'preview-repaints' "
     r"\(it reads barstate\.islast\)"),
    (lambda d: d["plots"][0].update(forward=1), r"plots\.value\.forward — declared 1 but this script reads 0"),
])
def test_a_malformed_or_forged_runtime_document_is_refused_by_name(store, monkeypatch, mutate, message):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    d = runtime_defn()
    mutate(d)
    with pytest.raises(ValueError, match=message):
        svc.save(USER, DEF_ID, d)


def test_the_count_cap_is_asked_for_a_runtime_document_too(store, monkeypatch):
    """The toolkit's count verdict is the same door a formula goes through."""
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    from api.services import entitlements
    asked = []

    def cap(count, limits):
        asked.append(count)
        if count >= 1:
            raise ValueError("cap reached")
    monkeypatch.setattr(entitlements, "check_definition_count", cap)
    svc.save(USER, DEF_ID, runtime_defn())
    with pytest.raises(ValueError, match="cap reached"):
        svc.save(USER, "u_0000000000a2", runtime_defn(def_id="u_0000000000a2"))
    assert asked == [0, 1]


# ─── the kill switch ─────────────────────────────────────────────────────────

def test_KILL_a_listed_script_is_refused_at_save_by_hash_and_by_id(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.KILL_ENV, rt.source_hash(SOURCE)[:16])
    with pytest.raises(ValueError, match="kill list"):
        svc.save(USER, DEF_ID, runtime_defn())
    monkeypatch.setenv(rt.KILL_ENV, f"junk, {DEF_ID.upper()}")
    with pytest.raises(ValueError, match="kill list"):
        svc.save(USER, DEF_ID, runtime_defn())
    # control: an unlisted script saves
    monkeypatch.setenv(rt.KILL_ENV, "u_ffffffffffff")
    assert svc.save(USER, DEF_ID, runtime_defn())["appended"] is True


def test_KILL_is_never_a_delete_the_served_row_is_stamped_the_stored_row_is_not(client, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    svc.save(USER, DEF_ID, runtime_defn())
    stored_before = svc.get(USER, DEF_ID)["definition"]
    monkeypatch.setenv(rt.KILL_ENV, DEF_ID)
    listed = client.get("/api/user-definitions").json()["definitions"]
    assert len(listed) == 1
    assert "kill list" in listed[0]["definition"]["meta"]["runtimeKilled"]
    assert listed[0]["scannable"] is False
    one = client.get(f"/api/user-definitions/{DEF_ID}").json()
    assert "runtimeKilled" in one["definition"]["meta"]
    hist = client.get(f"/api/user-definitions/{DEF_ID}/history").json()["versions"]
    assert all("runtimeKilled" in v["definition"]["meta"] for v in hist)
    # ⛔ the stored row is untouched, and unlisting brings it straight back
    assert svc.get(USER, DEF_ID)["definition"] == stored_before
    monkeypatch.setenv(rt.KILL_ENV, "")
    back = client.get("/api/user-definitions").json()["definitions"][0]
    assert "runtimeKilled" not in back["definition"]["meta"]


def test_the_preview_reads_the_kill_list_and_the_save_switch(client, monkeypatch):
    allow = rt.allow_list()
    assert client.get("/api/user-definitions/runtime-kill").json() ==         {"kill": [], "allow": allow, "save_enabled": False}
    monkeypatch.setenv(rt.KILL_ENV, f"{DEF_ID}, not-an-entry, {'A' * 64}")
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    got = client.get("/api/user-definitions/runtime-kill").json()
    assert got == {"kill": [DEF_ID, "a" * 64], "allow": allow, "save_enabled": True}


# ─── nothing that needs a tree admits a runtime row ──────────────────────────

def test_the_nightly_sweep_never_files_a_runtime_row(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    svc.save(USER, DEF_ID, runtime_defn())
    from api.services.screener import scan_evaluator
    assert scan_evaluator.definitions_to_sweep() == []


def test_the_relint_pass_skips_a_runtime_row_rather_than_calling_it_uncomparable(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    svc.save(USER, DEF_ID, runtime_defn())
    from api.services import user_definition_relint as relint
    report = relint.relint(heal=False)
    assert report["definitions_read"] == 1
    assert report["uncomparable"] == [] and report["needs_decision"] == []


def test_an_alert_cannot_bind_a_runtime_row(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    svc.save(USER, DEF_ID, runtime_defn())
    from api.services import alert_user_series
    row = svc.get(USER, DEF_ID)
    with pytest.raises(alert_user_series.AdmissionRefused, match="compute.kind 'runtime'"):
        alert_user_series._gate_lane(row)


# ─── one repaint class, two languages (RT2) ──────────────────────────────────

def test_a_repainting_script_is_STORED_with_its_class_not_refused(store, monkeypatch):
    """RT1 refused every source mentioning the live bar; RT2 states its class.
    A script reading `barstate.islast` is stored as `preview-repaints`, one reading
    `last_bar_index` as `repaints` — re-derived from the source, never read off it."""
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    d = runtime_defn(SOURCE + "plot(barstate.islast ? close : na)\n")
    d["meta"]["repaint"] = "preview-repaints"
    d["plots"][0]["forward"] = 1
    assert svc.save(USER, DEF_ID, d)["repaint"] == {"value": "preview-repaints"}
    d2 = runtime_defn(SOURCE + "plot(last_bar_index > 0 ? close : na)\n", def_id="u_0000000000a2")
    d2["meta"]["repaint"] = "repaints"
    d2["plots"][0]["forward"] = "unbounded"
    assert svc.save(USER, "u_0000000000a2", d2)["repaint"] == {"value": "repaints"}


def test_the_old_regex_gate_is_gone_on_both_sides():
    """The client door no longer carries `RUNTIME_REPAINT_RISK` and the server no
    longer carries `REPAINT_RISK`: one classifier per language, over one table."""
    js = MEMBER_PANE_JS.read_text(encoding="utf-8")
    assert "export const RUNTIME_REPAINT_RISK" not in js
    assert "runtimeRepaintOf(source)" in js
    assert not hasattr(rt, "REPAINT_RISK")
