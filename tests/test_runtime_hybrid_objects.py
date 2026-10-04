"""RT9 (2026-10-03) — the store's door for a HYBRID document: a formula (`ast`)
document whose drawings may be made by one run of its script (`objectsRun`).

`tests/fixtures/runtime_documents/hybrid_documents.json` holds what the client's
SAVE door sends for the two corpus scripts the member door makes hybrid (held to
the door by `app/.../memberPane/hybridObjects.test.js`). This file is the server
half:

* the formula half goes through every `ast` rule unchanged, and the run is under
  every gate a runtime document is under — the save switch, the saving member's
  stage, the kill list, the starter allowlist — each with the runtime door's own
  sentence;
* `objectsRun` has a stated shape, and its repaint class is RE-DERIVED from its
  source (never trusted) in both directions;
* a saved hybrid reloads byte-for-byte; a served one is stamped (kill / not graded)
  and never rewritten, and the client then installs it WITHOUT the run;
* the size caps: the formula half keeps the formula cap, the whole the runtime cap;
* CONTROL: the same document without `objectsRun` saves with the switches OFF, as
  it always did.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import runtime_definitions as rt
from api.services import runtime_repaint
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "hybrid_documents.json"
USER = "u-rt9-hybrid"
DOCS = json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]
BY_SLUG = {d["slug"]: d for d in DOCS}
ATR = BY_SLUG["atr-support-and-resistance"]["definition"]


def _size(d: dict) -> int:
    return len(json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def _host_only(d: dict) -> dict:
    out = copy.deepcopy(d)
    out.pop("objectsRun", None)
    return out


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    for env in (rt.SAVE_ENV, rt.KILL_ENV, rt.STAGE_ENV, rt.ALLOW_ENV):
        monkeypatch.delenv(env, raising=False)
    return tmp_path


def _open_doors(monkeypatch, *docs):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, rt.STAGE_ALL)
    monkeypatch.setenv(rt.ALLOW_ENV, ",".join(rt.source_hash(d["objectsRun"]["source"]) for d in docs))


@pytest.fixture
def client(store):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    return TestClient(app)


def test_the_fixture_is_two_hybrid_documents_from_the_door():
    """Non-vacuity: two documents, both `ast` with a run, the run's source the corpus file."""
    assert [d["slug"] for d in DOCS] == ["atr-support-and-resistance", "poor-man039s-volume-profile"]
    for d in DOCS:
        df = d["definition"]
        assert df["compute"]["kind"] == "ast"
        assert rt.is_hybrid(df) and not rt.is_runtime(df)
        assert df["objectsRun"]["source"] == (ROOT / d["file"]).read_text(encoding="utf-8")
        assert df["meta"]["runtimeSourceHash"] == rt.source_hash(df["objectsRun"]["source"])
        # the host program rides beside the run: it draws wherever the run does not
        # (off the listing, a moved setting, the run withheld) — never both at once
        assert "objects" in df


def test_ON_a_hybrid_saves_and_reloads_byte_for_byte(store, monkeypatch):
    _open_doors(monkeypatch, ATR)
    row = svc.save(USER, ATR["id"], copy.deepcopy(ATR), role="user")
    assert row["appended"] is True
    # the formula half went through the ast lane (a tree hash, not a runtime handle)
    assert row["ast_hash"].startswith("sha256:")
    back = svc.get(USER, ATR["id"])["definition"]
    # the run and its meta come back byte-for-byte (the formula half is served in the
    # materialised form every graph document is, unchanged by RT9 — the control below)
    assert back["objectsRun"] == ATR["objectsRun"]
    assert back["meta"] == ATR["meta"]
    # and the host compute it was minted beside is the one served: its identity holds
    assert back["compute"].get("treesHash") or back["compute"]["fn"]
    assert ATR["objectsRun"]["trees"] in (back["compute"].get("treesHash"), back["compute"]["fn"])
    control = _host_only(ATR)
    control["id"] = "u_0000000009b1"
    svc.save(USER, control["id"], control)
    ctl = svc.get(USER, control["id"])["definition"]
    strip = {k: v for k, v in back.items() if k not in ("objectsRun", "id")}
    assert strip == {k: v for k, v in ctl.items() if k != "id"}


def test_CONTROL_the_same_document_without_its_run_saves_with_every_switch_OFF(store):
    """Nothing about a formula document's save moved: the runtime doors are not asked."""
    d = _host_only(ATR)
    assert svc.save(USER, d["id"], copy.deepcopy(d))["appended"] is True
    assert "objectsRun" not in svc.get(USER, d["id"])["definition"]


def test_OFF_the_run_is_refused_with_the_runtime_doors_own_sentences(store, monkeypatch):
    d = copy.deepcopy(ATR)
    with pytest.raises(ValueError, match=r"switched off \(PINE_RUNTIME_SAVE_ENABLED\)"):
        svc.save(USER, d["id"], copy.deepcopy(d))
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    with pytest.raises(ValueError, match=r"switched on for no member"):
        svc.save(USER, d["id"], copy.deepcopy(d), role="user")
    monkeypatch.setenv(rt.STAGE_ENV, rt.STAGE_ADMINS)
    with pytest.raises(ValueError, match=r"admins only"):
        svc.save(USER, d["id"], copy.deepcopy(d), role="user")
    monkeypatch.setenv(rt.STAGE_ENV, rt.STAGE_ALL)
    with pytest.raises(ValueError, match=r"has not yet been graded"):
        svc.save(USER, d["id"], copy.deepcopy(d), role="user")
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(d["objectsRun"]["source"]))
    monkeypatch.setenv(rt.KILL_ENV, rt.source_hash(d["objectsRun"]["source"])[:16])
    with pytest.raises(ValueError, match=r"kill list"):
        svc.save(USER, d["id"], copy.deepcopy(d), role="user")
    assert svc.get(USER, d["id"]) is None
    monkeypatch.setenv(rt.KILL_ENV, "")
    assert svc.save(USER, d["id"], copy.deepcopy(d), role="user")["appended"] is True


@pytest.mark.parametrize("patch,match", [
    ({"kind": "ast"}, r"objectsRun\.kind"),
    ({"source": ""}, r"objectsRun\.source"),
    ({"trees": None}, r"objectsRun\.trees"),
    ({"inputs": [3]}, r"objectsRun\.inputs"),
    ({"repaint": "clean"}, r"objectsRun\.repaint"),
])
def test_a_malformed_run_is_refused_by_name(store, monkeypatch, patch, match):
    _open_doors(monkeypatch, ATR)
    d = copy.deepcopy(ATR)
    d["objectsRun"].update(patch)
    if "source" in patch:
        monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(d["objectsRun"]["source"]) + "," + rt.source_hash(ATR["objectsRun"]["source"]))
    with pytest.raises(ValueError, match=match):
        svc.save(USER, d["id"], d, role="user")
    assert svc.get(USER, d["id"]) is None


def test_the_runs_repaint_class_is_rederived_and_a_misstatement_is_refused_both_ways(store, monkeypatch):
    _open_doors(monkeypatch, ATR)
    derived = runtime_repaint.runtime_repaint_of(ATR["objectsRun"]["source"])["mode"]
    assert derived == ATR["objectsRun"]["repaint"]
    for wrong in {"non-repainting", "preview-repaints", "repaints"} - {derived}:
        d = copy.deepcopy(ATR)
        d["objectsRun"]["repaint"] = wrong
        with pytest.raises(ValueError, match=r"objectsRun\.repaint — declared"):
            svc.save(USER, d["id"], d, role="user")


def test_a_run_on_a_runtime_document_is_not_a_hybrid():
    """`is_hybrid` is an `ast` document's property only; a runtime document draws its own."""
    d = copy.deepcopy(ATR)
    d["compute"] = {"kind": "runtime", "source": "x", "outputs": {}}
    assert not rt.is_hybrid(d)
    with pytest.raises(ValueError, match=r"only an \"ast\" document"):
        rt.validate_objects_run(d)


def test_the_caps_formula_half_formula_cap_whole_runtime_cap(store, monkeypatch):
    big = BY_SLUG["poor-man039s-volume-profile"]["definition"]
    _open_doors(monkeypatch, big)
    # measured: its formula half alone is over the formula cap, as it was before RT9
    assert _size(_host_only(big)) > svc.MAX_DEFINITION_BYTES
    with pytest.raises(ValueError, match=r"definition exceeds"):
        svc.save(USER, big["id"], copy.deepcopy(big), role="user")
    # a hybrid whose run pushes the WHOLE past the runtime cap is refused with that number
    d = copy.deepcopy(ATR)
    d["objectsRun"]["source"] += "\n//" + "x" * (rt.RUNTIME_MAX_DEFINITION_BYTES)
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(d["objectsRun"]["source"]))
    with pytest.raises(ValueError, match=rf"definition exceeds {rt.RUNTIME_MAX_DEFINITION_BYTES} bytes"):
        svc.save(USER, d["id"], d, role="user")
    # and the run's bytes do not count against the FORMULA cap: atr's whole is over
    # nothing, its formula half under 64 KiB
    assert _size(_host_only(ATR)) <= svc.MAX_DEFINITION_BYTES


def test_KILL_and_ALLOWLIST_stamp_the_served_hybrid_and_rewrite_nothing(client, monkeypatch):
    _open_doors(monkeypatch, ATR)
    svc.save(USER, ATR["id"], copy.deepcopy(ATR), role="user")
    stored = svc.get(USER, ATR["id"])["definition"]
    h = rt.source_hash(ATR["objectsRun"]["source"])
    monkeypatch.setenv(rt.KILL_ENV, h[:16])
    served = client.get(f"/api/user-definitions/{ATR['id']}").json()["definition"]
    assert "kill list" in served["meta"]["runtimeKilled"]
    assert served["objectsRun"] == stored["objectsRun"]  # the run is kept; the client withholds it
    monkeypatch.setenv(rt.KILL_ENV, "")
    monkeypatch.setenv(rt.ALLOW_ENV, "")
    served = client.get(f"/api/user-definitions/{ATR['id']}").json()["definition"]
    assert "graded" in served["meta"]["runtimeNotGraded"]
    assert svc.get(USER, ATR["id"])["definition"] == stored  # nothing rewritten
    monkeypatch.setenv(rt.ALLOW_ENV, h)
    assert client.get(f"/api/user-definitions/{ATR['id']}").json()["definition"] == stored


def test_CONTROL_a_formula_document_without_a_run_is_never_stamped(client, monkeypatch):
    d = _host_only(ATR)
    svc.save(USER, d["id"], copy.deepcopy(d))
    monkeypatch.setenv(rt.KILL_ENV, d["meta"]["runtimeSourceHash"][:16])
    served = client.get(f"/api/user-definitions/{d['id']}").json()["definition"]
    assert "runtimeKilled" not in served["meta"] and "runtimeNotGraded" not in served["meta"]
