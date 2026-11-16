"""U15 Phase A -- a Pine library is served only with the sha256 of its own source, a document is
held to the library versions it was saved against, and a library version is admitted to the
runtime pane only on its own evidence.

Every library here is a fixture written from scratch for this file (no third-party code).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess

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


# ── the deny list: a version withheld until its drawing is verified (ruling 2026-11-15) ──────

DENY_PATH = "Fontiramisu/fontilab/11"


def test_the_deny_list_names_exactly_the_ruled_versions_with_reasons():
    doc = json.load(open(store.DENY_FILE, encoding="utf-8"))
    paths = [d["path"] for d in doc["deny"]]
    assert sorted(paths) == ["Fontiramisu/fontilab/11", "TradingView/ValueAtTime/2", "loxx/loxxexpandedsourcetypes/4"]
    assert all(d.get("reason") and d.get("evidence") for d in doc["deny"])
    # ruled OUT of the list: ta/11 (three scripts MATCH; Aroon's red is the engine's tie bug)
    # and VisibleChart/3 (INCONCLUSIVE is not wrong)
    assert "TradingView/ta/11" not in paths and "PineCoders/VisibleChart/3" not in paths
    assert "RE-GRADE TO MATCH" in " ".join(doc["_"])
    assert doc["memberSentence"] == "this library version is withheld until its drawing is verified against TradingView"


def test_a_denied_version_is_never_served_whatever_the_store_holds(root):
    a, n, v = DENY_PATH.split("/")
    store.write_entry(entry(path=DENY_PATH, source="//@version=5\nlibrary(\"fontilab\")\nexport f() => 1\n"))
    assert store.read_entry(DENY_PATH) is None
    assert [e["path"] for e in store.list_entries()] == []
    status, why = store.entry_status(DENY_PATH)
    assert status == "denied" and "withheld until its drawing is verified" in why[0]
    r = _client().get("/api/pine/libraries/" + DENY_PATH)
    assert r.status_code == 409 and r.json()["detail"]["code"] == store.DENIED
    _, refusal = store.pinned_entries([{"path": DENY_PATH, "sha256": sha("//@version=5\nlibrary(\"fontilab\")\nexport f() => 1\n")}])
    assert refusal[0] == store.DENIED_GUARD == "pine:library-denied"
    # denied even when the store does not hold it at all (never a plain 404)
    assert store.entry_status("TradingView/ValueAtTime/2")[0] == "denied"
    # control: a version not on the list is served as before
    store.write_entry(entry())
    assert store.entry_status("tester/pinlib/1")[0] == "ok"


def test_an_unreadable_deny_list_denies_every_version(root, monkeypatch):
    store.write_entry(entry())
    monkeypatch.setattr(store, "DENY_FILE", os.path.join(root, "no-such-deny.json"))
    assert store.entry_status("tester/pinlib/1")[0] == "denied"


@pytest.mark.parametrize("text", [
    "not json at all",
    "[]",
    "{}",
    '{"deny": "Fontiramisu/fontilab/11"}',
    '{"deny": [{"reason": "a row that names no path"}]}',
    '{"deny": [{"path": "Fontiramisu/fontilab/11"}, 5]}',
    '{"deny": [{"path": ""}]}',
    '{"deny": [{"path": 11}]}',
], ids=["not-json", "a-list", "no-deny", "deny-not-a-list", "row-without-path", "row-not-an-object", "empty-path",
        "path-not-a-string"])
def test_a_deny_list_that_cannot_be_read_as_one_denies_every_version(root, monkeypatch, text):
    """FAIL CLOSED, whichever way the file is wrong. One bad row makes the whole list unreadable:
    dropping it would serve exactly the version it was written to withhold."""
    store.write_entry(entry())
    bad = os.path.join(root, "deny.json")
    with open(bad, "w", encoding="utf-8") as f:
        f.write(text)
    monkeypatch.setattr(store, "DENY_FILE", bad)
    assert store.entry_status("tester/pinlib/1")[0] == "denied"
    assert store.read_entry("tester/pinlib/1") is None
    assert store.list_entries() == []
    _, refusal = store.pinned_entries([{"path": "tester/pinlib/1", "sha256": sha(LIB)}])
    assert refusal[0] == store.DENIED_GUARD


def test_control_a_readable_deny_list_denies_only_what_it_names(root, monkeypatch):
    store.write_entry(entry())
    store.write_entry(entry(path="tester/pinlib/2"))
    ok = os.path.join(root, "deny.json")
    with open(ok, "w", encoding="utf-8") as f:
        json.dump({"deny": [{"path": "tester/pinlib/2"}]}, f)
    monkeypatch.setattr(store, "DENY_FILE", ok)
    assert store.entry_status("tester/pinlib/1")[0] == "ok"
    assert store.entry_status("tester/pinlib/2")[0] == "denied"
    with open(ok, "w", encoding="utf-8") as f:
        json.dump({"deny": []}, f)                       # an empty list is readable: nothing denied
    assert store.entry_status("tester/pinlib/2")[0] == "ok"


# ── no library SOURCE is in this repository (the repository is public) ─────────────────────────
#
# A Pine library opens with a `library("Title")` declaration. Every file that holds one is named
# below with its reason: a fixture written from scratch for a rail. A new file with a library
# declaration turns this red until someone has looked at it and named it here. The scan reads
# tracked AND untracked-not-ignored files, so it is red before the `git add`, not after the push.

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: file -> why a library declaration may stand in it. Fixtures only, each written for its rail.
LIBRARY_DECLARATIONS_ALLOWED = {
    "tests/test_pine_library_pinning.py": "this file's fixtures (pinlib, a stand-in under a denied path, the scan's own cases)",
    "tests/test_pine_library_store.py": "the store rail's fixture library and the declaration parser's cases",
    "tools/pine_library/fetch_library.py": "the owner's fetch tool: it names the declaration it looks for, and holds no source",
    "docs/pine/vendor-harness/objects-triage-2026-09-28.md": "prose that quotes the declaration's shape, no source",
}

#: `library(` then a quote, as code or inside a string literal of any depth (`\"`, `\\\"`), at the
#: START OF A LINE, which is where Pine requires a declaration. An escaped newline (`\n`, `\r\n`
#: inside a string) and an opening quote or backtick count as a line start. `find_library("c")`,
#: `fixtureLibrary("x")` and `x.library("z")` are not declarations.
_LIBRARY_DECLARATION = re.compile(r"""(?:^|\\+[nr]|["'`])[ \t]*library[ \t]*\([ \t]*\\*["']""", re.M)

#: A real library runs to hundreds of lines; no fixture here needs more than a handful.
FIXTURE_LINES_MAX = 40


def library_declaration_files(root=REPO):
    """Every tracked or untracked-not-ignored text file under `root` holding a library declaration."""
    listed = subprocess.run(["git", "grep", "--untracked", "-l", "-I", "-F", "-e", "library", "--", "."],
                            cwd=root, capture_output=True, text=True, encoding="utf-8")
    assert listed.returncode in (0, 1), listed.stderr       # 1 = nothing matched; anything else = git failed
    out = []
    for rel in listed.stdout.splitlines():
        try:
            with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            continue
        if _LIBRARY_DECLARATION.search(text):
            out.append(rel.replace(os.sep, "/"))
    return sorted(out)


def longest_library_source(text):
    """The line count of the longest library source `text` holds (0 = none). A source runs from its
    declaration to the first blank line or the end of its template / triple-quoted string, or to the
    end of the one physical line it is written on when it is a string with escaped newlines."""
    longest = 0
    for m in _LIBRARY_DECLARATION.finditer(text):
        at = m.end()
        line = text[at:].split("\n", 1)[0]
        if "\\n" in line:                                   # one string literal, newlines escaped
            lines = line.count("\\n") + 1
        else:                                               # real lines, up to the first blank one
            lines = len(re.split(r"""\n[ \t]*\r?\n|`|\"\"\"|'''""", text[at:], maxsplit=1)[0].splitlines())
        longest = max(longest, lines)
    return longest


def test_no_file_holds_a_library_declaration_that_is_not_a_named_fixture():
    found = library_declaration_files()
    assert found, "the scan found no library declaration at all: it is not reading the repository"
    allowed = dict(LIBRARY_DECLARATIONS_ALLOWED, **JS_LIBRARY_FIXTURE_FILES)
    unnamed = [f for f in found if f not in allowed]
    assert not unnamed, ("these files hold a Pine `library(...)` declaration and are not named as fixture files "
                         "(LIBRARY_DECLARATIONS_ALLOWED / JS_LIBRARY_FIXTURE_FILES). The repository is public and "
                         "holds NO third-party library source: if this is a fixture written from scratch, name the "
                         "file with its reason; if it is fetched code, it belongs in the out-of-git store, never "
                         "here:\n  " + "\n  ".join(unnamed))
    gone = [f for f in allowed if f not in found]
    assert not gone, "named as holding a fixture library but no longer does (remove the row):\n  " + "\n  ".join(gone)


#: The JavaScript rails that write a fixture library, each from scratch for that rail.
JS_LIBRARY_FIXTURE_FILES = {
    "app/src/components/chart/engine/ast/pineLibraries.test.js": "the linker rail's fixture libraries",
    "app/src/components/chart/engine/ast/pineLibraryPinning.test.js": "the pinning rail's fixture libraries",
    "app/src/components/chart/engine/ast/pineLibraryValueFnName.test.js": "a fixture library",
    "app/src/components/chart/engine/__tests__/libraryLinkParity.test.js": "the splice check's fixture library",
    "app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.capRound4.test.js":
        "a stand-in written for the rail; the real version is read from the out-of-git store, opt-in",
    "app/src/components/chart/engine/runtime/__tests__/libraryImportRefusal.test.js": "a fixture library",
    "app/src/components/chart/builder/memberPane/runtimeLibraryDoor.test.js": "a fixture library",
    "app/src/components/chart/builder/memberPane/runtimeParamDefaults.test.js": "a fixture library",
    "app/src/components/chart/builder/usePineLibraries.test.jsx": "a fixture library",
    "services/pine_runtime/test/library.test.mjs": "the service rail's fixture library",
    "app/src/components/chart/engine/runtime/__tests__/w4ClassifierHonesty.test.js": "a fixture library",
    "app/src/components/chart/engine/ast/pine.test.js": "a three-line script that declares library(), to show the declaration is refused",
    "app/src/components/chart/engine/runtime/__tests__/runtimeStrategy.test.js": "the same three-line refusal case",
    "app/src/components/chart/engine/runtime/__tests__/sourceToRuntime.test.js": "the same three-line refusal case",
}


def test_the_scan_sees_a_declaration_written_each_way(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    cases = {
        "plain.pine": '//@version=5\nlibrary("x")\nexport f() => 1\n',
        "indented.pine": '//@version=6\n  library ( "x", overlay = true)\n',
        "single.pine": "library('x')\n",
        "in_python.py": 'LIB = "//@version=5\\nlibrary(\\"x\\")\\nexport f() => 1\\n"\n',
        "in_json.json": json.dumps({"path": "a/b/1", "source": '//@version=5\nlibrary("x")\n'}),
        "in_js.js": "const LIB = `//@version=5\nlibrary('x')\n`\n",
        "store/a/b/1.json": json.dumps({"path": "a/b/1", "source": '//@version=5\r\nlibrary("x")\r\n'}),
    }
    not_declarations = {
        "ctypes_use.py": 'import ctypes.util\nctypes.util.find_library("c")\n',
        "helper.js": 'const e = fixtureLibrary("x"); registerPineLibrary("y"); obj.library("z")\n',
        "prose.md": "a library (the TradingView one) is pinned; see library() in the manual\n",
    }
    for rel, text in {**cases, **not_declarations}.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="")
    assert library_declaration_files(str(tmp_path)) == sorted(cases)


def test_every_library_fixture_is_fixture_sized():
    """A fetched library pasted into a NAMED file would pass the list above. It does not pass this."""
    too_long = {}
    for rel in library_declaration_files():
        with open(os.path.join(REPO, rel), encoding="utf-8", errors="replace") as f:
            n = longest_library_source(f.read())
        if n > FIXTURE_LINES_MAX:
            too_long[rel] = n
    assert not too_long, "a library source longer than %d lines (a fixture is a handful): %r" % (FIXTURE_LINES_MAX, too_long)
    # the measure itself, both ways a source is written
    assert longest_library_source('LIB = "//@version=5\\nlibrary(\\"x\\")' + "\\nexport f() => 1" * 60 + '"\n') == 61
    assert longest_library_source('//@version=5\nlibrary("x")\n' + "export f() => 1\n" * 60 + "\nplot(close)\n") == 61
    assert longest_library_source("nothing here\n") == 0


def test_no_library_store_is_in_the_repository():
    """The store's own layout (`pine_libraries/<Author>/<Library>/<N>.json`) is never tracked or addable."""
    listed = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=REPO, capture_output=True,
                            text=True, encoding="utf-8", check=True).stdout.splitlines()
    assert len(listed) > 1000, "git listed almost nothing: the scan is not reading the repository"
    assert [p for p in listed if "pine_libraries/" in p or "pine-libraries" in p] == []


# ── the promotion allowlist is held to its own rule ───────────────────────────────────────────
# (tools/pine_library/promotion_allowlist.json: the only versions an owner may copy into the
# production store. The runtime pane is off for members, so the HOST-ONLY grade is the one that counts.)

PROMOTION = os.path.join(REPO, "tools", "pine_library", "promotion_allowlist.json")


def promotion_problems(doc, deny_paths):
    """Why a promotion allowlist breaks its rule, one sentence per problem ([] = it holds)."""
    out = []
    never = set((doc.get("neverPromoted") or {}).get("paths") or [])
    held = {r.get("path") for r in doc.get("heldOut") or []}
    for row in doc.get("promote") or []:
        p = row.get("path")
        if not store.parse_import_path(str(p)):
            out.append("%r is not a library version" % (p,))
        if not re.fullmatch(r"[0-9a-f]{64}", str(row.get("sha256"))):
            out.append("%s is not pinned by a sha256" % p)
        if not row.get("licence") or store.licence_problem(row):
            out.append("%s has no licence the store serves" % p)
        if p in deny_paths:
            out.append("%s is on the deny list" % p)
        if p in never or p in held:
            out.append("%s is also listed as held out or never promoted" % p)
        graded = row.get("hostOnly")
        if not isinstance(graded, dict) or not graded:
            out.append("%s has no host-only grade" % p)
        elif any(v != "MATCH" for v in graded.values()):
            out.append("%s is not MATCH host-only on every capture: %r" % (p, graded))
    return out


def test_every_promoted_library_is_pinned_licensed_undenied_and_match_host_only():
    doc = json.load(open(PROMOTION, encoding="utf-8"))
    deny = {d["path"] for d in json.load(open(store.DENY_FILE, encoding="utf-8"))["deny"]}
    assert doc["promote"], "an empty promote list would pass every check below: nothing was read"
    assert promotion_problems(doc, deny) == []
    # every denied version is accounted for as held out, never silently absent
    assert deny <= {r["path"] for r in doc["heldOut"]}
    # every never-promoted path is a version, and none is promoted
    assert all(store.parse_import_path(p) for p in doc["neverPromoted"]["paths"])


def test_the_promotion_rule_refuses_each_way_a_row_can_be_wrong():
    good = {"path": "tester/pinlib/1", "sha256": "a" * 64, "licence": "MPL-2.0", "hostOnly": {"cap-1": "MATCH"}}

    def problems(**change):
        return promotion_problems({"promote": [dict(good, **change)]}, {"tester/denied/1"})

    assert problems() == []
    assert problems(sha256="abc") != []
    assert problems(licence="CC-BY-NC-SA") != []
    assert problems(licence="") != []
    assert problems(nonCommercial=True) != []
    assert problems(path="tester/denied/1") != []
    assert problems(path="not a path") != []
    assert problems(hostOnly={}) != []
    assert problems(hostOnly=None) != []
    assert problems(hostOnly={"cap-1": "MATCH", "cap-2": "INCONCLUSIVE"}) != []
    assert problems(hostOnly={"cap-1": "DIVERGE"}) != []
    assert promotion_problems({"promote": [good], "heldOut": [{"path": "tester/pinlib/1"}]}, set()) != []
    assert promotion_problems({"promote": [good], "neverPromoted": {"paths": ["tester/pinlib/1"]}}, set()) != []
