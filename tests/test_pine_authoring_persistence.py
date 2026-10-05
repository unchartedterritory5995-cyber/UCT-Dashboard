"""A2 (2026-10-04) — a member's Pine source, stored with their document.

Integrator rulings (docs/pine/member-authoring-plan.md §5):

* O1 — the source is STORED (``meta.pineSource``), PRIVATE to its owner, and
  stripped from every copy that leaves the owner (share link, library install)
  unless its own header declares MPL-2.0 / MIT / Apache-2.0 — the predicate is
  ``tools/pine_survey/corpus_licence.py``. Server-side, fail closed. A runtime or
  hybrid document (whose Pine IS its implementation) is REFUSED at the door
  instead, unless permissive.
* O3 — ``PINE_AUTHORING_STAGE`` (off/admins/all, unset = off) per member, read
  per request, on the auth payload as ``pine_authoring_enabled``; the save door
  asks the same question before it keeps a NEW source.

Ownership: a member can never read, edit, delete or list another member's
definition — every store read is keyed on the caller.
"""
from __future__ import annotations

import copy
import hashlib
import importlib
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import indicator_alert_service as ias
from api.services import pine_authoring as pa
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
OWNER = "u-a2-owner"
OTHER = "u-a2-other"

PINE_NO_LICENCE = """//@version=5
indicator("Mine", overlay = true)
plot(close > 10 ? 1 : 0)
"""
PINE_MIT = """// Licensed under the MIT License
//@version=5
indicator("Mine", overlay = true)
plot(close > 10 ? 1 : 0)
"""
PINE_GPL = """// This work is licensed under the GNU General Public License v3
//@version=5
indicator("Mine")
plot(close)
"""

FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
_DOCS = {d["slug"]: d for d in json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]}
ADX = _DOCS["adx-and-di-for-v4"]["definition"]          # MPL-2.0 header, allowlisted


def _doc(def_id: str, name: str = "Mine", threshold: float = 10, source=None) -> dict:
    close = {"type": "series", "name": "close"}
    tree = {"type": "op", "name": ">", "args": [close, {"type": "num", "value": threshold}]}
    meta = {"name": name, "shortName": "MIN", "repaint": "non-repainting"}
    if source is not None:
        meta[pa.SOURCE_FIELD] = source
    return {
        "schemaVersion": 1, "id": def_id, "version": 1, "meta": meta,
        "compute": {"kind": "ast", "ast": tree, "fn": svc.ast_hash(tree)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    for k in (pa.STAGE_ENV, rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    return tmp_path


def _client(user_id: str, role: str = "member") -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": user_id, "role": role, "plan": "premium"}
    return TestClient(app)


def _payload_flag(role):
    auth = importlib.import_module("api.routers.auth")
    return auth._access_payload({"id": "u1", "email": "x@example.com", "role": role},
                                "free")["pine_authoring_enabled"]


def _save(user, src, *, role="member", name="Mine", threshold=10, def_id=None):
    def_id = def_id or svc.new_def_id()
    out = svc.save(user, def_id, _doc(def_id, name=name, threshold=threshold, source=src), role=role)
    return def_id, out


# ═══ O3 — the stage ═══════════════════════════════════════════════════════════

def test_O3_unset_is_OFF_for_everyone_and_the_default_is_pinned_in_source():
    assert pa.stage() == "off"
    assert _payload_flag("admin") is False and _payload_flag("member") is False
    assert pa.PINE_AUTHORING_MODE_FLAGS == {"PINE_AUTHORING_STAGE": ("off", ("off", "admins", "all"))}
    src = (ROOT / "api" / "services" / "pine_authoring.py").read_text(encoding="utf-8")
    assert "os.environ.get(STAGE_ENV, STAGE_OFF)" in src
    from api.services import feature_flag_index as ffi
    found = ffi.mode_flags([ROOT / "api"], ROOT)
    assert found["PINE_AUTHORING_STAGE"]["default"] == "off"
    ledger = json.loads((ROOT / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    flat = json.dumps(ledger)
    assert '"PINE_AUTHORING_STAGE"' in flat


@pytest.mark.parametrize("value", ["admin", "everyone", "1", "true", "on", "ALL ", " Admins"])
def test_O3_an_unrecognised_value_is_OFF(monkeypatch, value):
    monkeypatch.setenv(pa.STAGE_ENV, value)
    expected = {"all": "all", "admins": "admins"}.get(value.strip().lower(), "off")
    assert pa.stage() == expected
    if expected == "off":
        assert _payload_flag("admin") is False


def test_O3_admins_is_admin_only_and_a_missing_role_is_a_member(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "admins")
    assert _payload_flag("admin") is True
    assert _payload_flag("member") is False and _payload_flag(None) is False
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    assert _payload_flag("member") is True


def test_O3_the_flag_is_inside_the_shared_payload_and_never_raises(monkeypatch):
    src = (ROOT / "api" / "routers" / "auth.py").read_text(encoding="utf-8")
    assert src.index("**_pine_authoring_flag(") > src.index("def _access_payload")
    assert src.count('"pine_authoring_enabled"') == 2
    auth = importlib.import_module("api.routers.auth")

    def boom(_role):
        raise RuntimeError("stage unreadable")
    monkeypatch.setattr(pa, "permitted", boom)
    assert auth._pine_authoring_flag("admin") == {"pine_authoring_enabled": False}


# ═══ O1 + O3 — the save door ══════════════════════════════════════════════════

def test_a_permitted_member_stores_the_source_and_reads_it_back(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id, out = _save(OWNER, PINE_NO_LICENCE)
    assert out["pine_source"] == {"pine_source": "stored"}
    row = svc.get(OWNER, def_id)
    assert row["definition"]["meta"][pa.SOURCE_FIELD] == PINE_NO_LICENCE
    # ⛔ never compute: the stored hash is the tree's alone
    assert row["ast_hash"] == svc.ast_hash(_doc(def_id)["compute"]["ast"])


def test_stage_OFF_drops_a_new_source_and_says_so():
    def_id, out = _save(OWNER, PINE_NO_LICENCE, role="admin")
    assert out["pine_source"]["pine_source"] == "withheld"
    assert "PINE_AUTHORING_STAGE=off" in out["pine_source"]["reason"]
    assert pa.SOURCE_FIELD not in svc.get(OWNER, def_id)["definition"]["meta"]


def test_stage_ADMINS_keeps_an_admins_source_and_drops_a_members(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "admins")
    a, out_a = _save(OWNER, PINE_NO_LICENCE, role="admin")
    m, out_m = _save(OWNER, PINE_NO_LICENCE, role="member")
    n, out_n = _save(OWNER, PINE_NO_LICENCE, role=None)
    assert out_a["pine_source"]["pine_source"] == "stored"
    assert out_m["pine_source"]["pine_source"] == "withheld"
    assert out_n["pine_source"]["pine_source"] == "withheld"
    assert pa.SOURCE_FIELD in svc.get(OWNER, a)["definition"]["meta"]
    assert pa.SOURCE_FIELD not in svc.get(OWNER, m)["definition"]["meta"]


def test_a_rename_that_never_knew_the_field_CARRIES_the_source_and_a_maths_change_does_not(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id, _ = _save(OWNER, PINE_NO_LICENCE)
    renamed = _doc(def_id, name="Renamed")                    # no meta.pineSource at all
    out = svc.save(OWNER, def_id, renamed, role="member")
    assert out["pine_source"]["pine_source"] == "carried" and out["version"] == 2
    assert svc.get(OWNER, def_id)["definition"]["meta"][pa.SOURCE_FIELD] == PINE_NO_LICENCE
    # ⭐ the carry holds even after the stage turns off: the stage gates authoring, never deletes
    monkeypatch.setenv(pa.STAGE_ENV, "off")
    out = svc.save(OWNER, def_id, _doc(def_id, name="Renamed again"), role="member")
    assert out["pine_source"]["pine_source"] == "carried"
    # a maths change with no source: the script no longer describes the document
    out = svc.save(OWNER, def_id, _doc(def_id, name="Renamed again", threshold=11), role="member")
    assert out["rev_bumped"] is True and out["pine_source"]["pine_source"] == "none"
    assert pa.SOURCE_FIELD not in svc.get(OWNER, def_id)["definition"]["meta"]
    # and history still holds every version's source (restore reads it)
    versions = svc.history(OWNER, def_id)
    assert [pa.stored_source(v["definition"]) for v in versions] == \
        [PINE_NO_LICENCE, PINE_NO_LICENCE, PINE_NO_LICENCE, None]


def test_an_explicit_null_forgets_the_source(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id, _ = _save(OWNER, PINE_NO_LICENCE)
    svc.save(OWNER, def_id, _doc(def_id, name="x", source=None) | {"meta": {
        "name": "x", "shortName": "MIN", "repaint": "non-repainting", pa.SOURCE_FIELD: None}})
    assert pa.SOURCE_FIELD not in svc.get(OWNER, def_id)["definition"]["meta"]


def test_a_malformed_or_oversized_source_is_refused_by_field_and_the_source_has_its_OWN_cap(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    with pytest.raises(ValueError, match=r"meta\.pineSource: .*expected a string"):
        _save(OWNER, 42)
    with pytest.raises(ValueError, match=r"meta\.pineSource: the script is \d+ bytes, over"):
        _save(OWNER, "x" * (pa.PINE_SOURCE_MAX_BYTES + 1))
    # ⭐ a 100 KiB script does NOT count against the formula's 64 KiB cap
    big = "// " + "a" * (100 * 1024) + "\n" + PINE_NO_LICENCE
    def_id, out = _save(OWNER, big)
    assert out["appended"] is True and len(big) > svc.MAX_DEFINITION_BYTES
    assert svc.get(OWNER, def_id)["definition"]["meta"][pa.SOURCE_FIELD] == big


def test_a_byte_identical_resave_appends_nothing(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id, _ = _save(OWNER, PINE_NO_LICENCE)
    out = svc.save(OWNER, def_id, _doc(def_id, source=PINE_NO_LICENCE), role="member")
    assert out["appended"] is False and out["version"] == 1


# ═══ ownership — the privacy guarantee ═══════════════════════════════════════

def test_another_member_can_neither_read_edit_delete_nor_list_a_private_source(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    owner, other = _client(OWNER), _client(OTHER)
    created = owner.post("/api/user-definitions",
                         json={"definition": _doc("ignored", source=PINE_NO_LICENCE)})
    assert created.status_code == 200, created.text
    def_id = created.json()["def_id"]
    # the owner reads it back
    assert owner.get(f"/api/user-definitions/{def_id}").json()["definition"]["meta"][pa.SOURCE_FIELD] \
        == PINE_NO_LICENCE
    # nobody else can address it at all
    assert other.get(f"/api/user-definitions/{def_id}").status_code == 404
    assert other.get(f"/api/user-definitions/{def_id}?version=1").status_code == 404
    assert other.get(f"/api/user-definitions/{def_id}/history").status_code == 404
    assert other.put(f"/api/user-definitions/{def_id}",
                     json={"definition": _doc(def_id, name="hijack", source="//x")}).status_code == 404
    assert other.delete(f"/api/user-definitions/{def_id}").status_code == 404
    assert other.post(f"/api/user-definitions/{def_id}/share").status_code == 404
    assert all(r["def_id"] != def_id for r in other.get("/api/user-definitions").json()["definitions"])
    # and the owner's row is untouched by all of it
    row = svc.get(OWNER, def_id)
    assert row["version"] == 1 and row["definition"]["meta"]["name"] == "Mine"
    assert svc.get(OTHER, def_id) is None


def test_the_LIST_carries_a_summary_never_the_text(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id, _ = _save(OWNER, PINE_NO_LICENCE)
    _save(OWNER, None, name="formula only")
    rows = {r["def_id"]: r for r in _client(OWNER).get("/api/user-definitions").json()["definitions"]}
    row = rows[def_id]
    assert pa.SOURCE_FIELD not in row["definition"]["meta"]
    assert row["pine_source"] == {"bytes": len(PINE_NO_LICENCE.encode()), "licence": "NONE-IN-SOURCE"}
    assert [r["pine_source"] for k, r in rows.items() if k != def_id] == [None]


# ═══ O1 — share / list: the licence strip ════════════════════════════════════

def test_a_shared_formula_travels_WITHOUT_an_unlicensed_source(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id, _ = _save(OWNER, PINE_NO_LICENCE)
    token = svc.share(OWNER, def_id)["token"]
    preview = svc.resolve_share(token)["definition"]
    assert pa.SOURCE_FIELD not in preview["meta"]
    assert "NONE-IN-SOURCE" in preview["meta"][pa.WITHHELD_FIELD]
    installed = svc.install_share(OTHER, token, role="member")
    copy_ = svc.get(OTHER, installed["def_id"])["definition"]
    assert pa.SOURCE_FIELD not in copy_["meta"]
    # ⛔ the owner's own copy is untouched by the strip
    assert svc.get(OWNER, def_id)["definition"]["meta"][pa.SOURCE_FIELD] == PINE_NO_LICENCE


@pytest.mark.parametrize("src, travels", [(PINE_MIT, True), (PINE_GPL, False), (PINE_NO_LICENCE, False)])
def test_only_a_permissive_header_travels(monkeypatch, src, travels):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id, _ = _save(OWNER, src)
    resp = _client(OTHER).get(f"/api/user-definitions/shared/{svc.share(OWNER, def_id)['token']}")
    assert resp.status_code == 200
    meta = resp.json()["definition"]["meta"]
    assert (meta.get(pa.SOURCE_FIELD) == src) is travels
    assert (pa.WITHHELD_FIELD in meta) is (not travels)


def test_the_strip_FAILS_CLOSED_when_the_licence_predicate_cannot_be_read(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id, _ = _save(OWNER, PINE_MIT)
    token = svc.share(OWNER, def_id)["token"]

    def broken():
        raise ImportError("corpus_licence missing")
    monkeypatch.setattr(pa, "_corpus_licence", broken)
    meta = svc.resolve_share(token)["definition"]["meta"]
    assert pa.SOURCE_FIELD not in meta and "UNREADABLE" in meta[pa.WITHHELD_FIELD]


def test_the_licence_predicate_is_IMPORTED_not_restated():
    src = (ROOT / "api" / "services" / "pine_authoring.py").read_text(encoding="utf-8")
    assert "from tools.pine_survey import corpus_licence" in src
    assert "mozilla" not in src.lower().replace("mpl-2.0", "")


def test_a_client_supplied_withheld_note_is_not_trusted_on_the_way_out(monkeypatch):
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    def_id = svc.new_def_id()
    doc = _doc(def_id, source=PINE_MIT)
    doc["meta"][pa.WITHHELD_FIELD] = "forged"
    svc.save(OWNER, def_id, doc, role="member")
    meta = svc.resolve_share(svc.share(OWNER, def_id)["token"])["definition"]["meta"]
    assert meta[pa.SOURCE_FIELD] == PINE_MIT and pa.WITHHELD_FIELD not in meta


# ═══ O1 — a runtime document's Pine IS its implementation ════════════════════

def _runtime_env(monkeypatch, extra_sha=None):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(pa.STAGE_ENV, "all")
    if extra_sha:
        monkeypatch.setenv(rt.ALLOW_ENV, extra_sha)


def _unlicensed_adx():
    d = copy.deepcopy(ADX)
    lines = d["compute"]["source"].splitlines()
    d["compute"]["source"] = "\n".join(["// my private tweak"] + lines[1:])
    return d


def test_a_runtime_document_dedups_its_source_and_reopens_from_the_lane(monkeypatch):
    _runtime_env(monkeypatch)
    d = copy.deepcopy(ADX)
    d.setdefault("meta", {})[pa.SOURCE_FIELD] = d["compute"]["source"]
    out = svc.save(OWNER, d["id"], d, role="member")
    assert out["pine_source"]["pine_source"] == "stored"
    stored = svc.get(OWNER, d["id"])["definition"]
    assert pa.SOURCE_FIELD not in stored["meta"]
    assert pa.source_of(stored) == ADX["compute"]["source"]


def test_an_UNLICENSED_runtime_document_is_refused_at_share_list_AND_resolve(monkeypatch):
    d = _unlicensed_adx()
    _runtime_env(monkeypatch, hashlib.sha256(d["compute"]["source"].encode()).hexdigest())
    svc.save(OWNER, d["id"], d, role="member")
    with pytest.raises(svc.ShareRefused) as e:
        svc.share(OWNER, d["id"])
    assert e.value.reason == "licence" and "NONE-IN-SOURCE" in e.value.detail
    with pytest.raises(svc.ShareRefused) as e:
        svc.publish(OWNER, d["id"])
    assert e.value.reason == "licence" and "not listed" in e.value.detail
    assert svc.share_status(OWNER, d["id"]) is None            # nothing was minted
    resp = _client(OWNER).post(f"/api/user-definitions/{d['id']}/share")
    assert resp.status_code == 409 and resp.json()["detail"]["reason"] == "licence"
    # a link minted before the rule (or under a predicate that has since moved) is refused at resolve
    real = pa.share_refusal
    monkeypatch.setattr(pa, "share_refusal", lambda _d: None)
    token = svc.share(OWNER, d["id"])["token"]
    monkeypatch.setattr(pa, "share_refusal", real)
    with pytest.raises(svc.ShareRefused) as e:
        svc.resolve_share(token)
    assert e.value.reason == "licence"
    with pytest.raises(svc.ShareRefused):
        svc.install_share(OTHER, token, role="member")
    assert svc.list_for_user(OTHER) == []


def test_a_PERMISSIVE_runtime_document_still_shares(monkeypatch):
    _runtime_env(monkeypatch)
    svc.save(OWNER, ADX["id"], copy.deepcopy(ADX), role="member")
    token = svc.share(OWNER, ADX["id"])["token"]
    assert svc.resolve_share(token)["definition"]["compute"]["source"] == ADX["compute"]["source"]


def test_a_HYBRID_documents_run_source_is_held_to_the_same_rule():
    hybrid = {"compute": {"kind": "ast"}, "objectsRun": {"kind": "runtime", "source": PINE_GPL}}
    assert pa.lane_source(hybrid) == PINE_GPL
    assert "GPL-3.0" in pa.share_refusal(hybrid) and "draws its objects from" in pa.share_refusal(hybrid)
    hybrid["objectsRun"]["source"] = PINE_MIT
    assert pa.share_refusal(hybrid) is None
    assert pa.share_refusal({"compute": {"kind": "ast", "source": "close > 10"}}) is None
