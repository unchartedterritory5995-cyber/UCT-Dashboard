"""RF (2026-10-02) — the store's round trip for the runtime pane, on the REAL documents.

`tests/fixtures/runtime_documents/documents.json` holds the document the member
door mints today for each of the six corpus scripts that attach ONLY through the
runtime lane (held to the door by
`app/src/components/chart/builder/memberPane/runtimeDocumentRoundTrip.test.js`,
which also re-installs each one from JSON and compares its columns). This file is
the server half, with `PINE_RUNTIME_SAVE_ENABLED` ON in a TEST (never production):

* every document the store accepts reloads byte-for-byte identical (the client's
  half then proves an identical document draws identical columns);
* the repaint class is RE-DERIVED server side (RT2) and equals what the door
  stated — and a document that lies about it in either direction is refused;
* a member's edit (a new source) appends a version and bumps `rev`;
* a document over the store's size cap is refused BY NAME — measured here:
  trend-targets-algoalpha's document is larger than `MAX_DEFINITION_BYTES`;
* with the switch OFF the store refuses every one with its own sentence;
* a kill-listed script is served stamped (and the client install door refuses
  the stamp), and comes back unchanged when unlisted — nothing deleted.
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
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
USER = "u-rf-roundtrip"
DOCS = json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]


def _blob_size(definition: dict) -> int:
    return len(json.dumps(definition, sort_keys=True, separators=(",", ":"),
                          ensure_ascii=False).encode("utf-8"))


FITS = [d for d in DOCS if _blob_size(d["definition"]) <= svc.MAX_DEFINITION_BYTES]
TOO_BIG = [d for d in DOCS if _blob_size(d["definition"]) > svc.MAX_DEFINITION_BYTES]


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    monkeypatch.delenv(rt.SAVE_ENV, raising=False)
    monkeypatch.delenv(rt.KILL_ENV, raising=False)
    return tmp_path


@pytest.fixture
def client(store):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    return TestClient(app)


def test_the_fixture_is_the_six_runtime_only_documents():
    """Non-vacuity: the fixture exists, holds six runtime documents, and the
    partition below covers all of them."""
    assert len(DOCS) == 6
    assert all(d["definition"]["compute"]["kind"] == "runtime" for d in DOCS)
    assert len(FITS) + len(TOO_BIG) == len(DOCS)
    assert len(FITS) >= 1


@pytest.mark.parametrize("doc", FITS, ids=[d["slug"][:30] for d in FITS])
def test_ON_a_saved_runtime_document_reloads_identically_with_its_class_rederived(store, monkeypatch, doc):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    d = doc["definition"]
    row = svc.save(USER, d["id"], copy.deepcopy(d))
    assert row["appended"] is True
    # RT2: the class is re-derived from the source, and equals what the door stated
    derived = runtime_repaint.runtime_repaint_of(d["compute"]["source"])["mode"]
    assert derived == d["meta"]["repaint"]
    assert set(row["repaint"].values()) == {derived}
    assert set(row["repaint"]) == set(d["compute"]["outputs"])
    # reload: byte-for-byte the document that was saved
    assert svc.get(USER, d["id"])["definition"] == d


@pytest.mark.parametrize("doc", FITS[:1], ids=[d["slug"][:30] for d in FITS[:1]])
def test_a_document_that_misstates_its_class_is_refused_both_ways(store, monkeypatch, doc):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    d = copy.deepcopy(doc["definition"])
    for wrong in ("repaints", "preview-repaints"):
        d["meta"]["repaint"] = wrong
        with pytest.raises(ValueError, match=r"meta\.repaint — declared"):
            svc.save(USER, d["id"], d)
    assert svc.get(USER, d["id"]) is None


@pytest.mark.parametrize("doc", FITS[:1], ids=[d["slug"][:30] for d in FITS[:1]])
def test_an_edit_to_the_source_is_a_new_version_and_a_new_rev(store, monkeypatch, doc):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    d = copy.deepcopy(doc["definition"])
    first = svc.save(USER, d["id"], copy.deepcopy(d))
    d["compute"]["source"] += "\n// a member's edit\n"
    second = svc.save(USER, d["id"], d)
    assert (second["version"], second["rev"], second["rev_bumped"]) == \
        (first["version"] + 1, first["rev"] + 1, True)
    # the pinned old version is still served
    assert svc.get(USER, d["id"], 1)["definition"]["compute"]["source"] == doc["definition"]["compute"]["source"]


@pytest.mark.parametrize("doc", TOO_BIG, ids=[d["slug"][:30] for d in TOO_BIG])
def test_a_runtime_document_over_the_size_cap_is_refused_by_name(store, monkeypatch, doc):
    """Measured: the store refuses these by its own sentence. The member door
    offers them as saveable, so the member reads this sentence on Save."""
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    d = doc["definition"]
    with pytest.raises(ValueError, match=rf"definition exceeds {svc.MAX_DEFINITION_BYTES} bytes"):
        svc.save(USER, d["id"], copy.deepcopy(d))
    assert svc.get(USER, d["id"]) is None


@pytest.mark.parametrize("doc", DOCS, ids=[d["slug"][:30] for d in DOCS])
def test_OFF_the_store_refuses_every_runtime_document_with_its_own_sentence(store, doc):
    d = doc["definition"]
    with pytest.raises(ValueError, match=r"switched off \(PINE_RUNTIME_SAVE_ENABLED\)"):
        svc.save(USER, d["id"], copy.deepcopy(d))
    assert svc.get(USER, d["id"]) is None


def test_KILL_by_source_hash_stamps_the_served_row_and_unlisting_restores_it(client, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    d = FITS[0]["definition"]
    svc.save(USER, d["id"], copy.deepcopy(d))
    stored = svc.get(USER, d["id"])["definition"]
    # the client door's hash is the server's hash (`runtimeSourceHash`, RT1)
    assert d["meta"]["runtimeSourceHash"] == rt.source_hash(d["compute"]["source"])
    monkeypatch.setenv(rt.KILL_ENV, d["meta"]["runtimeSourceHash"][:16])
    served = client.get(f"/api/user-definitions/{d['id']}").json()["definition"]
    assert "kill list" in served["meta"]["runtimeKilled"]
    assert client.get("/api/user-definitions/runtime-kill").json()["kill"] == [d["meta"]["runtimeSourceHash"][:16]]
    assert svc.get(USER, d["id"])["definition"] == stored  # nothing rewritten
    monkeypatch.setenv(rt.KILL_ENV, "")
    back = client.get(f"/api/user-definitions/{d['id']}").json()["definition"]
    assert back == stored
