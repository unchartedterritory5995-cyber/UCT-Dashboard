"""GT (2026-10-02) — the runtime pane's switch-on rulings, the SERVER half.

Owner rulings implemented here (`docs/pine/runtime-pane-switch-on-plan.md`, GT):

* D1 — a per-member gate. `PINE_RUNTIME_STAGE` (`off` · `admins` · `all`), read
  PER REQUEST, DEFAULT `off` pinned in source, rides the auth payload resolved
  for the member (`pine_runtime_pane_enabled`), and the SAVE door asks the same
  question of the saving member.
* D2 — the store's cap for a RUNTIME document is 128 KiB; a formula keeps 64 KiB.
* D6 — the starter allowlist: only a script whose source sha256 is listed (the
  committed `api/data/pine_runtime_allowlist.json` ∪ `PINE_RUNTIME_ALLOWLIST`)
  is saved or served; others are refused / stamped by name; an empty union
  serves nothing. Today the committed list holds ONLY adx-and-di-for-v4.
* RT4 follow-up — a row saved under an older repaint rule whose stored label is
  looser than today's measurement is SERVED with a member-visible notice, and its
  stored label is never flipped.

The client half is `app/src/components/chart/engine/__tests__/runtimeSwitchOn.test.js`.
"""
from __future__ import annotations

import copy
import importlib
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import runtime_definitions as rt
from api.services import user_definition_relint as rl
from api.services import user_definitions as svc
from tests._p0_legacy_rows import save_legacy

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
DOCS = {d["slug"]: d for d in json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]}
ADX = DOCS["adx-and-di-for-v4"]["definition"]
DELTA = DOCS["delta-rsi-oscillator-strategy"]["definition"]
TREND = DOCS["trend-targets-algoalpha"]["definition"]
USER = "u-gt"


def _blob_size(definition: dict) -> int:
    return len(json.dumps(definition, sort_keys=True, separators=(",", ":"),
                          ensure_ascii=False).encode("utf-8"))


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV):
        monkeypatch.delenv(k, raising=False)
    rl._NOTICE_CACHE.clear()
    yield
    rl._NOTICE_CACHE.clear()


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    from api.services import indicator_alert_service as ias
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    return tmp_path


def _client(role: str) -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": role, "plan": "premium"}
    return TestClient(app)


def _payload_flag(role):
    auth = importlib.import_module("api.routers.auth")
    return auth._access_payload({"id": "u1", "email": "x@example.com", "role": role},
                                "free")["pine_runtime_pane_enabled"]


# ═══ D1 — the stage, per member, per request, default OFF ════════════════════

def test_D1_unset_is_OFF_for_admins_and_members_alike():
    assert rt.stage() == rt.STAGE_OFF
    assert _payload_flag("admin") is False
    assert _payload_flag("member") is False


def test_D1_the_default_is_pinned_in_SOURCE_not_only_in_behaviour():
    """The literal, not just the effect: changing the default and "fixing" the
    behaviour test would leave every member on a variable nobody set."""
    assert rt.STAGE_OFF == "off"
    assert rt.PINE_RUNTIME_MODE_FLAGS == {"PINE_RUNTIME_STAGE": ("off", ("off", "admins", "all"))}
    src = (ROOT / "api" / "services" / "runtime_definitions.py").read_text(encoding="utf-8")
    assert "os.environ.get(STAGE_ENV, STAGE_OFF)" in src
    # and the mode-flag index derives it, so the ledger can hold it to a decision
    from api.services import feature_flag_index as ffi
    found = ffi.mode_flags([ROOT / "api"], ROOT)
    assert found["PINE_RUNTIME_STAGE"]["default"] == "off"
    assert set(found["PINE_RUNTIME_STAGE"]["allowed"]) == {"off", "admins", "all"}


@pytest.mark.parametrize("value", ["admin", "everyone", "1", "true", "on", "ALL ", " Admins"])
def test_D1_an_unrecognised_value_is_OFF_never_the_opposite(monkeypatch, value):
    monkeypatch.setenv(rt.STAGE_ENV, value)
    expected = {"all": rt.STAGE_ALL, "admins": rt.STAGE_ADMINS}.get(value.strip().lower(), rt.STAGE_OFF)
    assert rt.stage() == expected
    if expected == rt.STAGE_OFF:
        assert _payload_flag("admin") is False and _payload_flag("member") is False


def test_D1_admins_means_ADMIN_ONLY_and_a_member_and_a_missing_role_see_OFF(monkeypatch):
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    assert _payload_flag("admin") is True
    assert _payload_flag("member") is False
    assert _payload_flag("user") is False
    assert _payload_flag(None) is False


def test_D1_all_means_everyone(monkeypatch):
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    assert _payload_flag("admin") is True and _payload_flag("member") is True


def test_D1_the_stage_is_read_PER_REQUEST():
    """⭐ THE ONE THAT MAKES "stage off = no deploy" TRUE. Same process, same
    imported module, no reload between the reads."""
    import os
    before = os.environ.get(rt.STAGE_ENV)
    try:
        os.environ[rt.STAGE_ENV] = "admins"
        assert _payload_flag("admin") is True
        os.environ[rt.STAGE_ENV] = "off"
        assert _payload_flag("admin") is False
        os.environ[rt.STAGE_ENV] = "all"
        assert _payload_flag("member") is True
    finally:
        if before is None:
            os.environ.pop(rt.STAGE_ENV, None)
        else:
            os.environ[rt.STAGE_ENV] = before


def test_D1_the_flag_lives_inside_the_shared_payload_helper():
    src = (ROOT / "api" / "routers" / "auth.py").read_text(encoding="utf-8")
    helper_at = src.index("def _access_payload")
    call_at = src.index("**_pine_runtime_pane_flag(")
    assert call_at > helper_at
    assert src.count('"pine_runtime_pane_enabled"') == 2  # the value and the never-raise fallback


# ═══ D1 — the SAVE door asks the saving member the same question ═════════════

def test_D1_save_a_MEMBER_cannot_save_while_the_stage_is_admins_and_an_ADMIN_can(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    with pytest.raises(ValueError, match=r"switched on for admins only right now \(PINE_RUNTIME_STAGE=admins\)"):
        svc.save(USER, ADX["id"], copy.deepcopy(ADX), role="member")
    with pytest.raises(ValueError, match=r"admins only"):
        svc.save(USER, ADX["id"], copy.deepcopy(ADX))          # no role = a member
    assert svc.get(USER, ADX["id"]) is None
    assert svc.save(USER, ADX["id"], copy.deepcopy(ADX), role="admin")["appended"] is True


def test_D1_save_nobody_while_the_stage_is_off_and_everybody_at_all(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    with pytest.raises(ValueError, match=r"switched on for no member right now \(PINE_RUNTIME_STAGE=off\)"):
        svc.save(USER, ADX["id"], copy.deepcopy(ADX), role="admin")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    assert svc.save(USER, ADX["id"], copy.deepcopy(ADX), role="member")["appended"] is True


def test_D1_save_the_ROUTER_passes_the_members_own_role(store, monkeypatch):
    """End to end through `POST /api/user-definitions`: the role comes from the
    authenticated user, so a member cannot save at `admins` and an admin can."""
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    r = _client("member").post("/api/user-definitions", json={"definition": copy.deepcopy(ADX)})
    assert r.status_code == 400 and "admins only" in r.json()["detail"]
    r = _client("admin").post("/api/user-definitions", json={"definition": copy.deepcopy(ADX)})
    assert r.status_code == 200, r.text
    assert r.json()["appended"] is True


def test_D1_the_save_SWITCH_is_still_asked_first(store, monkeypatch):
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    with pytest.raises(ValueError, match=r"switched off \(PINE_RUNTIME_SAVE_ENABLED\)"):
        svc.save(USER, ADX["id"], copy.deepcopy(ADX), role="admin")


# ═══ D6 — the starter allowlist ══════════════════════════════════════════════

def test_D6_the_committed_allowlist_holds_ONLY_adx_and_di_for_v4():
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    assert [s["slug"] for s in doc["scripts"]] == ["adx-and-di-for-v4"]
    assert rt.allow_list() == [ADX["meta"]["runtimeSourceHash"]]
    assert ADX["meta"]["runtimeSourceHash"] == rt.source_hash(ADX["compute"]["source"])


def test_D6_an_allowlisted_script_saves_and_an_ungraded_one_is_refused_by_name(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    assert svc.save(USER, ADX["id"], copy.deepcopy(ADX))["appended"] is True
    with pytest.raises(ValueError, match=r"has not yet been graded against TradingView"):
        svc.save(USER, DELTA["id"], copy.deepcopy(DELTA))
    assert svc.get(USER, DELTA["id"]) is None


def test_D6_adding_a_script_is_ONE_LINE_in_the_variable(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.ALLOW_ENV, DELTA["meta"]["runtimeSourceHash"][:16])
    assert svc.save(USER, DELTA["id"], copy.deepcopy(DELTA))["appended"] is True
    # the committed half still counts: the union, not a replacement
    assert svc.save(USER, ADX["id"], copy.deepcopy(ADX))["appended"] is True


def test_D6_an_EMPTY_union_serves_NOTHING(store, monkeypatch, tmp_path):
    empty = tmp_path / "allow.json"
    empty.write_text('{"scripts": []}', encoding="utf-8")
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(empty))
    assert rt.allow_list() == []
    assert rt.not_graded(ADX["compute"]["source"])
    # an unreadable file contributes nothing either (fail closed)
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(tmp_path / "missing.json"))
    assert rt.allow_list() == [] and rt.not_graded(ADX["compute"]["source"])
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    with pytest.raises(ValueError, match=r"not yet been graded"):
        svc.save(USER, ADX["id"], copy.deepcopy(ADX))


def test_D6_a_definition_id_is_NOT_an_allowlist_entry(monkeypatch):
    """Grading is a property of the script: an id would admit whatever source
    somebody later saves under it."""
    monkeypatch.setenv(rt.ALLOW_ENV, f"{ADX['id']}, junk")
    assert ADX["id"] not in rt.allow_list()


def test_D6_a_stored_ungraded_row_is_SERVED_stamped_and_never_rewritten(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.ALLOW_ENV, DELTA["meta"]["runtimeSourceHash"])
    svc.save(USER, DELTA["id"], copy.deepcopy(DELTA))
    stored = svc.get(USER, DELTA["id"])["definition"]
    monkeypatch.delenv(rt.ALLOW_ENV)                 # graded no longer
    client = _client("member")
    served = client.get(f"/api/user-definitions/{DELTA['id']}").json()["definition"]
    assert "not yet been graded" in served["meta"]["runtimeNotGraded"]
    listed = client.get("/api/user-definitions").json()["definitions"]
    assert "runtimeNotGraded" in listed[0]["definition"]["meta"]
    assert svc.get(USER, DELTA["id"])["definition"] == stored   # nothing rewritten
    monkeypatch.setenv(rt.ALLOW_ENV, DELTA["meta"]["runtimeSourceHash"])
    back = client.get(f"/api/user-definitions/{DELTA['id']}").json()["definition"]
    assert back == stored


def test_D6_the_preview_read_carries_the_allowlist(store, monkeypatch):
    got = _client("member").get("/api/user-definitions/runtime-kill").json()
    assert got["allow"] == [ADX["meta"]["runtimeSourceHash"]]
    monkeypatch.setenv(rt.ALLOW_ENV, "B" * 12)
    got = _client("member").get("/api/user-definitions/runtime-kill").json()
    assert got["allow"] == [ADX["meta"]["runtimeSourceHash"], "b" * 12]


# ═══ D2 — the cap, split by kind ═════════════════════════════════════════════

def test_D2_the_two_caps_are_what_the_owner_ruled():
    assert svc.MAX_DEFINITION_BYTES == 64 * 1024
    assert rt.RUNTIME_MAX_DEFINITION_BYTES == 128 * 1024


def test_D2_trend_targets_saves_under_the_runtime_cap(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.ALLOW_ENV, TREND["meta"]["runtimeSourceHash"])
    assert svc.MAX_DEFINITION_BYTES < _blob_size(TREND) <= rt.RUNTIME_MAX_DEFINITION_BYTES
    assert svc.save(USER, TREND["id"], copy.deepcopy(TREND))["appended"] is True


def test_D2_a_FORMULA_keeps_its_64_KiB_cap(store):
    """A formula between 64 and 128 KiB is still refused at 64 KiB: the runtime
    cap did not leak into the formula door."""
    d = {"schemaVersion": 1, "id": "u_00000000f0a1", "version": 1,
         "meta": {"name": "pad", "shortName": "pad", "description": ""},
         "compute": {"kind": "ast", "ast": {"type": "series", "name": "close"}},
         "placement": {"target": "lower"},
         "plots": [{"key": "value", "style": "line", "role": "primary"}], "inputs": []}
    d["meta"]["description"] = "x" * (svc.MAX_DEFINITION_BYTES + 1024)
    assert svc.MAX_DEFINITION_BYTES < _blob_size(d) < rt.RUNTIME_MAX_DEFINITION_BYTES
    with pytest.raises(ValueError, match=rf"definition exceeds {svc.MAX_DEFINITION_BYTES} bytes"):
        svc.save(USER, d["id"], d)
    assert svc.get(USER, d["id"]) is None


# ═══ RT4 follow-up — the stored label is kept, and its owner is TOLD ═════════

def _ast(def_id, leaf):
    return {"schemaVersion": 1, "id": def_id, "version": 1,
            "meta": {"name": leaf, "shortName": leaf},
            "compute": {"kind": "ast", "ast": {"type": "series", "name": leaf}},
            "placement": {"target": "lower"},
            "plots": [{"key": "value", "style": "line", "role": "primary"}], "inputs": []}


def _force_stored(def_id, verdicts):
    con = sqlite3.connect(svc._DB_PATH)
    try:
        con.execute("UPDATE user_definitions SET repaint=? WHERE def_id=? AND version=1",
                    (json.dumps(verdicts, sort_keys=True, separators=(",", ":")), def_id))
        con.commit()
    finally:
        con.close()


def test_RT4_a_pre_fix_row_reading_a_clock_leaf_is_served_WITH_a_notice_and_never_flipped(store):
    edge, stable = "u_000000000e51", "u_000000000e52"
    # ⭐ P0/0P — a PRE-FIX row is by definition stored before the save gate.
    save_legacy(USER, edge, _ast(edge, "islast"))
    svc.save(USER, stable, _ast(stable, "isconfirmed"))
    _force_stored(edge, {"value": "non-repainting"})       # what a pre-3a77b89423 save stored
    stored_before = sqlite3.connect(svc._DB_PATH).execute(
        "SELECT repaint FROM user_definitions WHERE def_id=?", (edge,)).fetchone()[0]
    client = _client("member")
    one = client.get(f"/api/user-definitions/{edge}").json()
    notice = one["repaint_notice"]
    assert notice["plots"] == [{"plot_key": "value", "stored": "non-repainting",
                                "current": "preview-repaints"}]
    assert "saved under an older repaint rule" in notice["sentence"]
    assert "kept as it was" in notice["sentence"]
    listed = {r["def_id"]: r for r in client.get("/api/user-definitions").json()["definitions"]}
    assert listed[edge]["repaint_notice"] == notice
    # ⭐ CONTROL: a stable leaf saved the same way carries no notice
    assert listed[stable]["repaint_notice"] is None
    assert client.get(f"/api/user-definitions/{stable}").json()["repaint_notice"] is None
    # ⛔ the stored label is untouched by serving it
    assert sqlite3.connect(svc._DB_PATH).execute(
        "SELECT repaint FROM user_definitions WHERE def_id=?", (edge,)).fetchone()[0] == stored_before
    assert one["repaint"] == {"value": "non-repainting"}


def test_RT4_a_fresh_save_of_the_same_leaf_carries_no_notice(store):
    edge = "u_000000000e53"
    # ⭐ P0/0P — a FRESH save of a `repaints` leaf is now refused at the save
    # door, so the fresh row this rail needs is the acknowledged
    # `preview-repaints` leaf; the refusal itself is pinned beside it.
    with pytest.raises(svc.SaveRefused) as refused:
        svc.save(USER, "u_000000000e54", _ast("u_000000000e54", "lastbarindex"))
    assert refused.value.gate == "repaint"
    svc.save(USER, edge, _ast(edge, "islast"), repaint_acknowledged=True)
    assert _client("member").get(f"/api/user-definitions/{edge}").json()["repaint_notice"] is None


def test_RT4_the_notice_never_raises_on_an_unreadable_row():
    assert rl.member_notice({"user_id": "u", "def_id": "u_x", "version": 1,
                             "definition": {"compute": {"kind": "ast", "ast": {"type": "nope"}}},
                             "repaint": "not-a-dict"}) is None
