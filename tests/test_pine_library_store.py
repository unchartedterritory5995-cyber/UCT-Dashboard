"""L1 - the Pine library store, its read door, and the fetch tool's offline parts.

Every library here is a fixture written for this file. No third-party library
source is in this repository (the store is a data directory, never git).
"""
from __future__ import annotations

import hashlib
import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import pine_library_store as store

FIXTURE = (
    "// This Pine Script code is subject to the terms of the Mozilla Public License 2.0\n"
    "//@version=5\n"
    'library("fixturelib")\n'
    "export mid(float h, float l) => (h + l) / 2\n"
)


def _entry(path="tester/fixturelib/1", source=FIXTURE, **kw):
    a, n, v = path.split("/")
    e = {
        "path": path, "author": a, "name": n, "version": int(v), "source": source,
        "sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
        "licence": "MPL-2.0", "licenceBasis": "header",
        "attribution": "fixturelib v1 (test fixture)", "url": None,
    }
    e.update(kw)
    return e


@pytest.fixture()
def root(tmp_path, monkeypatch):
    monkeypatch.setenv("PINE_LIBRARY_DIR", str(tmp_path))
    return str(tmp_path)


def test_store_root_reads_the_env_then_the_data_dir(monkeypatch):
    monkeypatch.setenv("PINE_LIBRARY_DIR", "/x/libs")
    assert store.store_root() == "/x/libs"
    monkeypatch.delenv("PINE_LIBRARY_DIR")
    monkeypatch.setenv("DATA_DIR", "/vol")
    assert store.store_root() == os.path.join("/vol", "pine_libraries")


def test_import_path_parsing_is_exact():
    assert store.parse_import_path("TradingView/ta/7") == ("TradingView", "ta", 7)
    for bad in ("TradingView/ta", "TradingView/ta/0", "../ta/7", "a/b/7/8", "a b/c/1", "a/b/x"):
        assert store.parse_import_path(bad) is None, bad


def test_write_then_read_round_trip(root):
    fp = store.write_entry(_entry())
    assert fp == os.path.join(root, "tester", "fixturelib", "1.json")
    got = store.read_entry("tester/fixturelib/1")
    assert got["source"] == FIXTURE and got["licence"] == "MPL-2.0"
    # a different VERSION is a different entry, never a substitute
    assert store.read_entry("tester/fixturelib/2") is None


def test_an_entry_without_a_licence_or_with_a_bad_hash_is_never_served(root):
    with pytest.raises(ValueError):
        store.write_entry(_entry(licence=""))
    # hand-written onto disk, bypassing write_entry: still refused at read
    d = os.path.join(root, "tester", "fixturelib")
    os.makedirs(d)
    with open(os.path.join(d, "1.json"), "w", encoding="utf-8") as f:
        json.dump(_entry(sha256="0" * 64), f)
    assert store.read_entry("tester/fixturelib/1") is None
    with open(os.path.join(d, "1.json"), "w", encoding="utf-8") as f:
        json.dump(_entry(source="//@version=5\nindicator('x')\n", sha256=None), f)
    assert store.read_entry("tester/fixturelib/1") is None


def test_list_is_metadata_only(root):
    store.write_entry(_entry())
    store.write_entry(_entry(path="tester/fixturelib/2"))
    listed = store.list_entries()
    assert [e["path"] for e in listed] == ["tester/fixturelib/1", "tester/fixturelib/2"]
    assert all("source" not in e for e in listed)


def _client(root):
    from api.middleware.auth_middleware import get_current_user
    from api.routers import pine_libraries

    app = FastAPI()
    app.include_router(pine_libraries.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    return TestClient(app)


def test_the_read_door(root):
    store.write_entry(_entry())
    c = _client(root)
    r = c.get("/api/pine/libraries/tester/fixturelib/1")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == FIXTURE and body["licence"] == "MPL-2.0" and body["attribution"]
    assert c.get("/api/pine/libraries/tester/fixturelib/9").status_code == 404
    assert c.get("/api/pine/libraries/tester/fixturelib/x").status_code == 400
    assert [e["path"] for e in c.get("/api/pine/libraries").json()["libraries"]] == ["tester/fixturelib/1"]


def test_the_read_door_is_signed_in_only():
    from api.routers import pine_libraries
    from api.middleware.auth_middleware import get_current_user

    routes = [r for r in pine_libraries.router.routes if getattr(r, "path", "").startswith("/api/pine/libraries")]
    assert len(routes) == 2  # non-vacuity
    for r in routes:
        deps = [d.call for d in r.dependant.dependencies]
        assert get_current_user in deps, r.path


def test_fetch_tool_reads_the_library_declaration_exactly():
    from tools.pine_library.fetch_library import declares, imports_in

    assert declares('//x\nlibrary("ta", overlay=true)\n', "ta")
    assert declares("library(title='MathOperator')\n", "MathOperator")
    assert not declares('library("tax")\n', "ta")
    assert not declares('indicator("ta")\n', "ta")
    assert imports_in("//@version=5\nimport A/b/7 as x\n  import C/d/2\nimport E / f / 3\n") == ["A/b/7", "E/f/3"]
