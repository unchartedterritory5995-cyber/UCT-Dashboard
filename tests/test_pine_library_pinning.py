"""U15 Phase A -- a Pine library is served only with the sha256 of its own source, a document is
held to the library versions it was saved against, and a library version is admitted to the
runtime pane only on its own evidence.

Every library here is a fixture written from scratch for this file (no third-party code).
"""
from __future__ import annotations

import hashlib
import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import pine_capabilities as pc
from api.services import pine_library_store as store
from api.services import pine_runtime_client as prc
from api.services import rollout_gate
from api.services import runtime_definitions as rd

LIB = "//@version=5\nlibrary(\"pinlib\")\nexport twice(float x) => x * 2\n"
LIB_V2 = "//@version=5\nlibrary(\"pinlib\")\nexport twice(float x) => x * 2.0 + 0\n"


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def entry(path="tester/pinlib/1", source=LIB, **kw):
    a, n, v = path.split("/")
    e = {"path": path, "author": a, "name": n, "version": int(v), "source": source,
         "sha256": sha(source), "licence": "MPL-2.0", "attribution": "pinlib (test fixture)"}
    e.update(kw)
    return e


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setenv("PINE_LIBRARY_DIR", str(tmp_path))
    return str(tmp_path)


def put_raw(root, e):
    d = os.path.join(root, e["author"], e["name"])
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "%d.json" % e["version"]), "w", encoding="utf-8") as f:
        json.dump(e, f)


# ── the store: no sha, not served ──────────────────────────────────────────────

def test_an_entry_without_a_sha256_is_held_but_never_served(root):
    with pytest.raises(ValueError):
        store.write_entry(entry(sha256=None))
    put_raw(root, entry(sha256=None))
    assert store.read_entry("tester/pinlib/1") is None
    status, why = store.entry_status("tester/pinlib/1")
    assert status == "unservable" and any("sha256" in w for w in why)
    assert store.list_entries() == []
    # a held entry is told apart from one the store does not hold
    assert store.entry_status("tester/pinlib/2") == ("missing", None)


def test_a_sha256_that_is_not_the_sources_is_not_served(root):
    put_raw(root, entry(sha256=sha(LIB_V2)))
    assert store.entry_status("tester/pinlib/1")[0] == "unservable"
    put_raw(root, entry(sha256=sha(LIB).upper()))   # not lowercase hex: not a sha this store writes
    assert store.entry_status("tester/pinlib/1")[0] == "unservable"


def _client():
    from api.middleware.auth_middleware import get_current_user
    from api.routers import pine_libraries

    app = FastAPI()
    app.include_router(pine_libraries.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    return TestClient(app)


def test_the_read_door_answers_409_by_name_for_a_held_unservable_entry(root):
    put_raw(root, entry(sha256=None))
    c = _client()
    r = c.get("/api/pine/libraries/tester/pinlib/1")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == store.NO_SHA
    assert "sha256" in r.json()["detail"]["reason"]
    # control: not held at all is still 404; a served entry carries its sha
    assert c.get("/api/pine/libraries/tester/pinlib/2").status_code == 404
    store.write_entry(entry(path="tester/pinlib/3"))
    ok = c.get("/api/pine/libraries/tester/pinlib/3")
    assert ok.status_code == 200 and ok.json()["sha256"] == sha(LIB)


# ── the pins a server run is held to ──────────────────────────────────────────

def test_pinned_entries_honour_only_the_pinned_code(root):
    store.write_entry(entry())
    got, why = store.pinned_entries([{"path": "tester/pinlib/1", "sha256": sha(LIB)}])
    assert why is None and [e["path"] for e in got] == ["tester/pinlib/1"]
    assert got[0]["source"] == LIB and got[0]["sha256"] == sha(LIB)
    # the store now holds OTHER code under the same version
    _, why = store.pinned_entries([{"path": "tester/pinlib/1", "sha256": sha(LIB_V2)}])
    assert why[0] == "pine:library-changed" and "has changed since this script was saved" in why[1]
    _, why = store.pinned_entries([{"path": "tester/pinlib/9", "sha256": sha(LIB)}])
    assert why[0] == "runtime:library"
    _, why = store.pinned_entries([{"path": "tester/pinlib/1"}])
    assert why[0] == "pine:library-changed"


def test_pinned_entries_refuse_a_held_unservable_entry_by_name(root):
    put_raw(root, entry(sha256=None))
    _, why = store.pinned_entries([{"path": "tester/pinlib/1", "sha256": sha(LIB)}])
    assert why[0] == "pine:library-no-sha"


class _Transport:
    def __init__(self):
        self.bodies = []

    def __call__(self, url, body, headers, timeout):
        self.bodies.append(json.loads(body))
        return 503, b"{}"


def _client_with(transport):
    return prc.PineRuntimeClient(url="http://svc.invalid/run", secret="s" * 32,
                                 identity={"bundle_sha256": "0" * 64}, transport=transport,
                                 sleep=lambda _s: None)


def _job():
    return prc.Job(job="j1", ticker="AAA", exchange="NYSE", tf="D",
                   bars=[{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])


def test_the_server_client_withholds_every_job_on_a_changed_library_and_sends_nothing(root):
    store.write_entry(entry())
    t = _Transport()
    doc = {"id": "u_x", "compute": {"kind": "runtime"}, "meta": {
        "libraries": [{"path": "tester/pinlib/1", "sha256": sha(LIB_V2)}]}}
    out = _client_with(t).run(def_id="u_x", version=1, doc=doc, owner_id="o", profile="alert", jobs=[_job()])
    assert t.bodies == []
    assert out[0].status == "withheld" and out[0].run_refusal().guard == "pine:library-changed"


def test_the_server_client_sends_the_pinned_entries_with_the_document(root):
    store.write_entry(entry())
    t = _Transport()
    doc = {"id": "u_x", "compute": {"kind": "runtime"}, "meta": {
        "libraries": [{"path": "tester/pinlib/1", "sha256": sha(LIB)}]}}
    _client_with(t).run(def_id="u_x", version=1, doc=doc, owner_id="o", profile="alert", jobs=[_job()])
    assert t.bodies, "the request was sent"
    libs = t.bodies[0]["definition"]["libraries"]
    assert [e["path"] for e in libs] == ["tester/pinlib/1"]
    assert libs[0]["sha256"] == sha(LIB) and libs[0]["source"] == LIB
    # control: a document with no pins sends no `libraries` key at all
    t2 = _Transport()
    _client_with(t2).run(def_id="u_x", version=1, doc={"id": "u_x", "compute": {"kind": "runtime"}, "meta": {}},
                         owner_id="o", profile="alert", jobs=[_job()])
    assert "libraries" not in t2.bodies[0]["definition"]


# ── admission: one row per library version ───────────────────────────────────

SRC = "//@version=5\nindicator(\"t\")\nimport tester/pinlib/1 as p\nimport tester/other/2\nplot(p.twice(close))\n"


def test_the_detector_names_each_imported_version():
    caps = pc.capabilities_of(SRC)
    assert {"import", "library:tester/pinlib/1", "library:tester/other/2"} <= caps
    assert pc.is_library_capability("library:TradingView/ta/7")
    for bad in ("library:ta", "library:a/b/0", "library:a/b/c", "import", "library:a/b/7/8"):
        assert not pc.is_library_capability(bad), bad
    # a commented-out import names nothing
    assert not any(pc.is_library_capability(c) for c in pc.capabilities_of(
        "//@version=5\nindicator(\"t\")\n// import tester/pinlib/1 as p\nplot(close)\n"))


def _ev(script, capture, community=True, path="tester/pinlib/1", sha256=None, **kw):
    e = {"capture": capture, "script": script, "community": community, "verdict": "MATCH", "runtimePane": "on",
         "library": {"path": path, "sha256": sha256 or sha(LIB)}}
    e.update(kw)
    return e


def _row(evidence, sha256=None):
    return {"status": "conformant", "admitted": True, "sha256": sha256 or sha(LIB), "evidence": evidence}


NAME = "library:tester/pinlib/1"


def test_a_library_version_is_admitted_on_two_importing_scripts_one_community():
    row = _row([_ev("Script A", "a-rddt"), _ev("vw-probe-lib", "vw-probe-lib-rddt", community=False)])
    assert rollout_gate.pine_capability_admission(NAME, row) == []


def test_a_library_row_without_a_sha_pin_is_not_admitted():
    row = _row([_ev("Script A", "a-rddt"), _ev("Script B", "b-rddt")])
    row.pop("sha256")
    reasons = rollout_gate.pine_capability_admission(NAME, row)
    assert any("pins no library sha256" in r for r in reasons)


def test_evidence_graded_against_other_code_or_a_fixture_never_counts():
    other = sha(LIB_V2)
    for bad in (_ev("Script B", "b-rddt", sha256=other),            # another code under the version
                _ev("Script B", "b-rddt", path="tester/pinlib/2"),  # another version
                _ev("Script B", "b-rddt", libraryFixture=True),     # a fixture library
                {k: v for k, v in _ev("Script B", "b-rddt").items() if k != "library"}):
        row = _row([_ev("Script A", "a-rddt"), bad])
        reasons = rollout_gate.pine_capability_admission(NAME, row)
        assert any("admission needs 2 from 2" in r for r in reasons), (bad, reasons)


def test_two_captures_of_one_script_or_no_community_script_is_not_enough():
    one_script = _row([_ev("Script A", "a-rddt"), _ev("Script A", "a-spy")])
    assert any("from 1 script" in r for r in rollout_gate.pine_capability_admission(NAME, one_script))
    probes = _row([_ev("vw-a", "vw-a-rddt", community=False), _ev("vw-b", "vw-b-rddt", community=False)])
    assert any("no community script" in r for r in rollout_gate.pine_capability_admission(NAME, probes))


def test_import_is_met_only_when_every_imported_version_is_admitted(monkeypatch):
    caps = frozenset({"core", "import", "method-call", "library:tester/pinlib/1", "library:tester/other/2"})
    monkeypatch.setattr(rd, "capabilities_for", lambda *a, **k: caps)
    base = ["core", "method-call"]

    def admitted(names):
        monkeypatch.setattr(rd, "admitted_capabilities", lambda: {"admitted": list(names)})

    admitted(base + ["library:tester/pinlib/1", "library:tester/other/2"])
    assert rd.capability_admitted(SRC) == (True, [])
    admitted(base + ["library:tester/pinlib/1"])
    ok, missing = rd.capability_admitted(SRC)
    assert not ok and missing == ["import", "library:tester/other/2"]
    # an `import` with no library version it names is never met (fail closed)
    monkeypatch.setattr(rd, "capabilities_for", lambda *a, **k: frozenset({"core", "import"}))
    admitted(["core"])
    assert rd.capability_admitted(SRC) == (False, ["import"])


def test_the_registry_reader_accepts_a_library_row_by_its_own_rule(monkeypatch):
    good = _row([_ev("Script A", "a-rddt"), _ev("Script B", "b-rddt")])
    monkeypatch.setattr(rd, "_allowlist_doc", lambda: {"capabilities": {NAME: good, "library:bad": good}})
    monkeypatch.setattr(rd, "capability_deny", lambda: [])
    got = rd.admitted_capabilities()
    assert NAME in got["admitted"]
    assert "library:bad" in got["withheld"]


# ── the licence gate: a non-commercial library is never served on this paid product ──────────
# (coordinator ruling 2026-11-15; the JS twin is pineLibraryStore.libraryLicenceProblem, and
# LICENCE_CASES below is the one table both rails read)

LICENCE_CASES = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "ast", "library_licence_cases.json"),
                               encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", LICENCE_CASES, ids=lambda c: c["licence"] + ("+flag" if c.get("nonCommercial") else ""))
def test_the_licence_rule_is_the_tables(case):
    e = {"licence": case["licence"], **({"nonCommercial": True} if case.get("nonCommercial") else {})}
    assert bool(store.licence_problem(e)) is case["nonCommercialExpected"]


def test_a_non_commercial_library_is_stored_but_answered_409_by_name_and_never_run(root):
    store.write_entry(entry(licence="CC-BY-NC-SA"))         # stored, so the door can say why
    assert store.read_entry("tester/pinlib/1") is None
    assert store.list_entries() == []
    status, why = store.entry_status("tester/pinlib/1")
    assert status == "licence" and "CC-BY-NC-SA" in why[0] and "non-commercial" in why[0]
    r = _client().get("/api/pine/libraries/tester/pinlib/1")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == store.NON_COMMERCIAL
    assert "CC-BY-NC-SA" in r.json()["detail"]["reason"]
    _, refusal = store.pinned_entries([{"path": "tester/pinlib/1", "sha256": sha(LIB)}])
    assert refusal[0] == store.LICENCE_GUARD == "pine:library-licence"
    # the flag the fetch records is read too, whatever the id says
    store.write_entry(entry(path="tester/pinlib/2", licence="Custom", nonCommercial=True))
    assert store.entry_status("tester/pinlib/2")[0] == "licence"
    # control: an MPL-2.0 entry beside it is served
    store.write_entry(entry(path="tester/pinlib/3"))
    assert store.entry_status("tester/pinlib/3")[0] == "ok"
