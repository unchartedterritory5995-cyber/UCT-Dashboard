"""U15 Phase A -- a Pine library is served only with the sha256 of its own source, a document is
held to the library versions it was saved against, and a library version is admitted to the
runtime pane only on its own evidence.

Every library here is a fixture written from scratch for this file (no third-party code).
"""
from __future__ import annotations

import glob
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


#: the committed allowlist, read before any test points the store elsewhere
COMMITTED_PROMOTION = store.PROMOTION_FILE


def write_promotion(path, doc):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    return str(path)


@pytest.fixture(autouse=True)
def fixture_promotion(tmp_path_factory, monkeypatch):
    """Since 2026-11-17 the store serves only what the promotion allowlist promotes, at its sha.
    Every test here runs against an allowlist promoting the fixture versions it serves
    (`tester/pinlib/1..3` at sha(LIB)); the fail-closed rails below choose their own."""
    allow = tmp_path_factory.mktemp("promotion") / "promotion_allowlist.json"
    monkeypatch.setattr(store, "PROMOTION_FILE", write_promotion(allow, {
        "promote": [{"path": "tester/pinlib/%d" % v, "sha256": sha(LIB)} for v in (1, 2, 3)]}))


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
    "tests/test_pine_library_pinning.py": "this file's fixtures (pinlib, stand-ins under a denied, a held-out and an "
                                          "unlisted path, the scan's own cases)",
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
    "app/src/components/chart/engine/ast/pineLibraryVersion.test.js": "the cross-version rail's fixture libraries (U15 Phase B)",
    "app/src/components/chart/engine/ast/runtimePaletteScope.test.js":
        "the palette-scope rail's fixture library (tester/palettelib/1, a v5 colour component inside the version island)",
    "app/src/components/chart/engine/__tests__/libraryLinkParity.test.js": "the splice check's fixture library",
    "app/src/components/chart/engine/__tests__/vendorHarness/storeHeld.test.js":
        "two fixture libraries written for the store-held rail (tester/inner/1, tester/outer/1)",
    "app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.capRound4.test.js":
        "a stand-in written for the rail; the real version is read from the out-of-git store, opt-in",
    "app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.qbh0Controls.test.js":
        "the Q-BH0 island control's fixture library (tester/qbh0island/1, a v5 bool's history inside a v6 script)",
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
# production store.) A version is promoted on one of two grades:
#   * HOST-ONLY: every capture of every importing script the host lane newly draws grades MATCH with the runtime
#     pane off (`hostOnly`, U15). That was the only path while members had no runtime lane.
#   * RUNTIME-ONLY (coordinator ruling 2026-11-19, libraries chain L2): since 2026-11-17 every member is on the
#     runtime lane (PINE_RUNTIME_STAGE=all) and its per-version admission row (`library:Author/Library/N`) is the
#     member gate there. A version that NO importer draws on the host lane may be promoted with an EMPTY `hostOnly`
#     when (a) `notAttaching` names EVERY importer capture with its host-only refusal (so the promotion draws
#     nothing new on the host lane), and (b) `runtimeOn` carries the full admission evidence for that version,
#     pinned to the sha256 it graded and stamped with the engine it was graded at (`gradedAtEngine`).
#     `rollout_gate.pine_capability_admission` judges (b): the rule is the admission row's, never restated here.

PROMOTION = os.path.join(REPO, "tools", "pine_library", "promotion_allowlist.json")
CAPTURES = os.path.join(REPO, "tests", "fixtures", "vendor", "harness")
_IMPORT_LINE = re.compile(r"(?m)^\s*import\s+([A-Za-z0-9_]+/[A-Za-z0-9_]+/[0-9]+)")


def committed_capture_imports(folder=CAPTURES):
    """{capture id: {library versions its recorded source imports}} over the committed captures. Only a file that
    holds `import ` at all is parsed (48 of 909 on 2026-11-19, ~2 s)."""
    out = {}
    for f in sorted(glob.glob(os.path.join(folder, "*.json"))):
        with open(f, "rb") as fh:
            raw = fh.read()
        if b"import " not in raw:
            continue
        cap = json.loads(raw)
        src = (cap.get("source") or {}).get("text") if isinstance(cap.get("source"), dict) else None
        found = set(_IMPORT_LINE.findall(src or ""))
        if found:
            out[cap.get("id") or os.path.splitext(os.path.basename(f))[0]] = found
    return out


def _importing_versions(path, promoted_rows):
    """`path` and every promoted version that imports it, directly or through another promoted version."""
    out = {path}
    grew = True
    while grew:
        grew = False
        for r in promoted_rows:
            p = r.get("path")
            if p not in out and set(r.get("imports") or []) & out:
                out.add(p)
                grew = True
    return out


def runtime_only_problems(row, doc, captures, engine):
    """Why a promote row with an EMPTY `hostOnly` does not meet the runtime-only path, [] when it does."""
    p = row.get("path")
    out = []
    promoted = [r for r in doc.get("promote") or [] if isinstance(r, dict)]
    via = _importing_versions(p, promoted)
    # (a) every importer capture is named, with its host-only refusal
    na = row.get("notAttaching")
    if not isinstance(na, dict) or not na or not all(isinstance(v, str) and v.strip() for v in na.values()):
        out.append("%s has an empty host-only grade and no `notAttaching` refusal for its importers" % p)
        na = {}
    importers = sorted(c for c, libs in (captures or {}).items() if libs & via)
    missing = [c for c in importers if c not in na]
    if missing:
        out.append("%s: importer capture(s) %s are named neither in hostOnly nor in notAttaching" % (p, missing))
    # (b) the full admission evidence, pinned and stamped
    ev = row.get("runtimeOn")
    at = row.get("gradedAtEngine")
    if not isinstance(ev, list) or not ev:
        return out + ["%s has an empty host-only grade and no runtime admission evidence (`runtimeOn`)" % p]
    if not (isinstance(at, int) and not isinstance(at, bool) and isinstance(engine, int) and 0 < at <= engine):
        out.append("%s: `gradedAtEngine` %r is not an engine at or before this one (%r)" % (p, at, engine))
    shas = {r.get("path"): str(r.get("sha256") or "").lower() for r in promoted}
    libs = {(e.get("library") or {}).get("path") for e in ev if isinstance(e, dict)}
    if len(libs) != 1 or not (libs <= via):
        return out + ["%s: `runtimeOn` must grade one version, this one or a promoted version importing it: %r"
                      % (p, sorted(map(str, libs)))]
    lib = libs.pop()
    for e in ev:
        pin = (e.get("library") or {}) if isinstance(e, dict) else {}
        if str(pin.get("sha256") or "").lower() != shas.get(lib):
            out.append("%s: runtime evidence %r graded %s under another sha than the one promoted"
                       % (p, e.get("capture") if isinstance(e, dict) else e, lib))
        if not isinstance(e, dict) or e.get("scriptEngineVersion") != at:
            out.append("%s: runtime evidence %r is not stamped with the engine it was graded at (%r)"
                       % (p, e.get("capture") if isinstance(e, dict) else e, at))
        if isinstance(e, dict) and e.get("capture") not in na:
            out.append("%s: runtime evidence %r is not named in notAttaching (it must not draw host-only)"
                       % (p, e.get("capture")))
    reasons = rollout_gate.pine_capability_admission(
        rollout_gate.PINE_CAPABILITY_LIBRARY_PREFIX + lib,
        {"status": rollout_gate.PINE_CAPABILITY_CONFORMANT, "admitted": True, "sha256": shas.get(lib), "evidence": ev})
    out.extend("%s: %s" % (p, r) for r in reasons)
    return out


def promotion_problems(doc, deny_paths, captures=None, engine=None):
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
        # ⭐ U15 Phase B (2026-11-16): a promoted version is linked with what IT imports, so every one of
        # those must be promoted too, or the importing script is refused at the nested import line
        imports = row.get("imports")
        promoted = {r.get("path") for r in doc.get("promote") or []}
        if not isinstance(imports, list):
            out.append("%s does not record what it imports" % p)
        else:
            out.extend("%s imports %s, which is not promoted" % (p, dep) for dep in imports if dep not in promoted)
        graded = row.get("hostOnly")
        if isinstance(graded, dict) and graded:
            if any(v != "MATCH" for v in graded.values()):
                out.append("%s is not MATCH host-only on every capture: %r" % (p, graded))
        elif isinstance(graded, dict):
            out.extend(runtime_only_problems(row, doc, captures, engine))
        else:
            out.append("%s has no host-only grade" % p)
    return out


def test_every_promoted_library_is_pinned_licensed_undenied_and_match_host_only():
    doc = json.load(open(PROMOTION, encoding="utf-8"))
    deny = {d["path"] for d in json.load(open(store.DENY_FILE, encoding="utf-8"))["deny"]}
    assert doc["promote"], "an empty promote list would pass every check below: nothing was read"
    from api.services import user_definitions
    caps = committed_capture_imports()
    assert len(caps) > 20, "the committed captures yielded almost no importer: the scan is not reading them"
    assert promotion_problems(doc, deny, caps, user_definitions.SCRIPT_ENGINE_VERSION) == []
    # every denied version is accounted for as held out, never silently absent
    assert deny <= {r["path"] for r in doc["heldOut"]}
    # every never-promoted path is a version, and none is promoted
    assert all(store.parse_import_path(p) for p in doc["neverPromoted"]["paths"])


def test_the_promotion_rule_refuses_each_way_a_row_can_be_wrong():
    good = {"path": "tester/pinlib/1", "sha256": "a" * 64, "licence": "MPL-2.0", "hostOnly": {"cap-1": "MATCH"},
            "imports": []}

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
    assert problems(imports=None) != []
    assert problems(imports=["tester/other/1"]) != []
    dep = dict(good, path="tester/other/1")
    assert promotion_problems({"promote": [dict(good, imports=["tester/other/1"]), dep]}, set()) == []


def _rt_entry(cap, script, community, path="tester/pinlib/1", sha="a" * 64, engine=80, **extra):
    return dict({"capture": cap, "script": script, "community": community, "verdict": "MATCH", "runtimePane": "on",
                 "library": {"path": path, "sha256": sha}, "scriptEngineVersion": engine}, **extra)


RT_GOOD = {"path": "tester/pinlib/1", "sha256": "a" * 64, "licence": "MPL-2.0", "imports": [], "hostOnly": {},
           "notAttaching": {"cap-a": "host-only: refused by name (pine:state)",
                            "cap-b": "host-only: refused by name (pine:function-def)"},
           "gradedAtEngine": 80,
           "runtimeOn": [_rt_entry("cap-a", "Community script", True), _rt_entry("cap-b", "Our probe", False)]}
RT_CAPTURES = {"cap-a": {"tester/pinlib/1"}, "cap-b": {"tester/pinlib/1"}, "cap-x": {"tester/other/1"}}


def test_the_runtime_only_promotion_refuses_each_way_a_row_can_be_wrong():
    """Coordinator ruling 2026-11-19: an EMPTY `hostOnly` is a promotion only when (a) `notAttaching` names every
    importer capture with its host-only refusal and (b) `runtimeOn` carries the full admission evidence, pinned to
    the sha and stamped with the engine it was graded at. Each control below breaks exactly one of those."""

    def problems(captures=RT_CAPTURES, engine=80, rows=None, **change):
        return promotion_problems({"promote": rows or [dict(RT_GOOD, **change)]}, set(), captures, engine)

    assert problems() == []
    # (a) every importer capture named, with a refusal
    assert problems(notAttaching=None) != []
    assert problems(notAttaching={}) != []
    assert problems(notAttaching=dict(RT_GOOD["notAttaching"], **{"cap-a": " "})) != []
    assert problems(captures=dict(RT_CAPTURES, **{"cap-c": {"tester/pinlib/1"}})) != []
    # (b) the admission evidence: present, enough, community, MATCH with the pane on
    assert problems(runtimeOn=None) != []
    assert problems(runtimeOn=[]) != []
    assert problems(runtimeOn=RT_GOOD["runtimeOn"][:1]) != []
    assert problems(runtimeOn=[_rt_entry("cap-a", "Probe one", False), _rt_entry("cap-b", "Probe two", False)]) != []
    assert problems(runtimeOn=[_rt_entry("cap-a", "Community script", True, verdict="DIVERGE"),
                               RT_GOOD["runtimeOn"][1]]) != []
    assert problems(runtimeOn=[_rt_entry("cap-a", "Community script", True, runtimePane="off"),
                               RT_GOOD["runtimeOn"][1]]) != []
    # ... pinned to the promoted sha: one stray entry under another sha fails even when two good ones remain
    na3 = dict(RT_GOOD["notAttaching"], **{"cap-c": "host-only: refused by name"})
    caps3 = dict(RT_CAPTURES, **{"cap-c": {"tester/pinlib/1"}})
    stray = RT_GOOD["runtimeOn"] + [_rt_entry("cap-c", "Third script", True, sha="b" * 64)]
    assert problems(captures=caps3, notAttaching=na3, runtimeOn=RT_GOOD["runtimeOn"] + [
        _rt_entry("cap-c", "Third script", True)]) == []
    assert problems(captures=caps3, notAttaching=na3, runtimeOn=stray) != []
    assert problems(runtimeOn=[_rt_entry("cap-a", "Community script", True, path="tester/other/1"),
                               _rt_entry("cap-b", "Our probe", False, path="tester/other/1")]) != []
    # ... stamped with the engine it was graded at, never a later one than this build's
    assert problems(gradedAtEngine=None) != []
    assert problems(gradedAtEngine=81, runtimeOn=[_rt_entry("cap-a", "Community script", True, engine=81),
                                                  _rt_entry("cap-b", "Our probe", False, engine=81)]) != []
    assert problems(engine=82) == []
    assert problems(runtimeOn=[_rt_entry("cap-a", "Community script", True, engine=79),
                               RT_GOOD["runtimeOn"][1]]) != []
    # ... and every runtime capture is one the host lane refuses (named in notAttaching)
    assert problems(notAttaching={"cap-a": "host-only: refused by name"},
                    captures={"cap-a": {"tester/pinlib/1"}}) != []
    # a nested-only version is graded through a promoted version that imports it, and only such a version
    outer = dict(RT_GOOD, imports=["tester/inner/1"])
    inner = dict(RT_GOOD, path="tester/inner/1", sha256="c" * 64)
    assert problems(rows=[outer, inner]) == []
    assert problems(rows=[dict(RT_GOOD), inner]) != []
    # a non-empty hostOnly keeps the host-only rule, untouched
    assert promotion_problems({"promote": [dict(RT_GOOD, hostOnly={"cap-1": "MATCH"})]}, set(), RT_CAPTURES, 80) == []


# ── U15 Phase B: the cross-version admission table (coordinator ruling 2026-11-16) ─────────────────
# A v5 library is linked into a v6 script only for a version this table names; a version is named only
# when it is promoted AND every capture of every newly attaching v6 importer grades MATCH host-only.

CROSS_VERSION = os.path.join(REPO, "app", "src", "components", "chart", "engine", "ast", "pineLibraryCrossVersion.json")


def cross_version_problems(doc, promotion):
    """Why the admission table breaks its rule, one sentence per problem ([] = it holds)."""
    out = []
    rows = doc.get("admit")
    if not isinstance(rows, list):
        return ["the table has no `admit` list"]
    promoted = {r.get("path") for r in promotion.get("promote") or []}
    for row in rows:
        p = row.get("path") if isinstance(row, dict) else None
        if not isinstance(p, str) or not store.parse_import_path(p):
            out.append("%r is not a library version" % (p,))
            continue
        if p not in promoted:
            out.append("%s is not a promoted version" % p)
        graded = row.get("v6Importers")
        if not isinstance(graded, dict) or not graded:
            out.append("%s names no graded v6 importer" % p)
        elif any(v != "MATCH" for v in graded.values()):
            out.append("%s has a v6 importer that is not MATCH host-only: %r" % (p, graded))
    return out


def test_every_cross_version_admission_is_promoted_and_match_in_v6_scripts():
    doc = json.load(open(CROSS_VERSION, encoding="utf-8"))
    assert cross_version_problems(doc, json.load(open(PROMOTION, encoding="utf-8"))) == []
    assert "fail closed" in " ".join(doc["_"]).lower()


def test_the_cross_version_rule_refuses_each_way_a_row_can_be_wrong():
    promotion = {"promote": [{"path": "tester/pinlib/1"}]}
    good = {"path": "tester/pinlib/1", "v6Importers": {"cap-1": "MATCH"}}
    assert cross_version_problems({"admit": [good]}, promotion) == []
    assert cross_version_problems({"admit": [dict(good, path="tester/other/1")]}, promotion) != []
    assert cross_version_problems({"admit": [dict(good, v6Importers={})]}, promotion) != []
    assert cross_version_problems({"admit": [dict(good, v6Importers={"cap-1": "MATCH", "cap-2": "INCONCLUSIVE"})]}, promotion) != []
    assert cross_version_problems({"admit": [dict(good, path="not a path")]}, promotion) != []
    assert cross_version_problems({}, promotion) != []


# ── the owner's promotion check and install (tools/pine_library/promotion_check.py) ───────────────

def _promotion_check():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "promotion_check", os.path.join(REPO, "tools", "pine_library", "promotion_check.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


OUTER = "//@version=5\nlibrary(\"outer\")\nimport tester/pinlib/1 as p\nexport f(float x) => p.twice(x)\n"


def _doc(*rows):
    return {"promote": [{"path": e["path"], "sha256": e["sha256"], "licence": "MPL-2.0", "imports": [],
                         "hostOnly": {"cap": "MATCH"}} for e in rows],
            "heldOut": [{"path": "tester/held/1"}], "neverPromoted": {"paths": []}}


def test_the_promotion_check_passes_only_on_the_pinned_code(tmp_path):
    pc_ = _promotion_check()
    stage = str(tmp_path / "stage")
    e = entry()
    store.write_entry(e, root=stage)
    assert pc_.check(stage, _doc(e))[0] == []
    # a different sha under the same path
    other = entry(source=LIB_V2)
    assert any("allowlist pins" in p for p in pc_.check(stage, _doc(other))[0])
    # missing
    assert any("missing" in p for p in pc_.check(str(tmp_path / "empty"), _doc(e))[0])
    # a promoted library whose own import is not promoted
    outer = entry(path="tester/outer/1", source=OUTER)
    store.write_entry(outer, root=stage)
    assert any("imports tester/pinlib/1, which is not promoted" in p for p in pc_.check(stage, _doc(outer))[0])
    assert pc_.check(stage, _doc(outer, e))[0] == []
    # --exact: a served entry that is not promoted fails; a held-out one is named
    held = entry(path="tester/held/1")
    store.write_entry(held, root=stage)
    problems, lines = pc_.check(stage, _doc(outer, e), exact=True)
    assert any("tester/held/1 is a valid entry in this store and is not promoted (held out)" in p for p in problems)
    assert any(l.startswith("OTHER") and "tester/held/1" in l for l in lines)
    assert pc_.check(stage, _doc(outer, e), exact=False)[0] == []
    # an empty allowlist is never a pass
    assert pc_.check(stage, {"promote": []})[0] != []


def test_the_promotion_install_plans_then_copies_and_never_overwrites(tmp_path):
    pc_ = _promotion_check()
    stage, target = str(tmp_path / "stage"), str(tmp_path / "target")
    e = entry()
    store.write_entry(e, root=stage)
    problems, plan = pc_.install(stage, target, _doc(e), apply=False)
    assert problems == [] and any(l.startswith("COPY") for l in plan)
    assert not os.path.exists(target), "a plan wrote something"
    problems, plan = pc_.install(stage, target, _doc(e), apply=True)
    assert problems == [] and store.entry_status("tester/pinlib/1", root=target)[1]["sha256"] == e["sha256"]
    # again: kept, not rewritten
    assert any(l.startswith("KEEP") for l in pc_.install(stage, target, _doc(e), apply=True)[1])
    # the target holds OTHER code under the path: refused, nothing written
    target2 = str(tmp_path / "target2")
    store.write_entry(entry(source=LIB_V2), root=target2)
    problems, _ = pc_.install(stage, target2, _doc(e), apply=True)
    assert any("refusing to overwrite" in p for p in problems)
    assert store.stored_status("tester/pinlib/1", root=target2)[1]["sha256"] == sha(LIB_V2)
    # a staging store that fails `check --exact` installs nothing
    store.write_entry(entry(path="tester/held/1"), root=stage)
    target3 = str(tmp_path / "target3")
    problems, _ = pc_.install(stage, target3, _doc(e), apply=True)
    assert problems and not os.path.exists(target3)


def test_the_promotion_check_defaults_to_this_servers_store(root, capsys):
    pc_ = _promotion_check()
    assert pc_.main(["check", "--allowlist", PROMOTION]) == 1
    assert "store: %s" % root in capsys.readouterr().out


# ── the store FAILS CLOSED: it serves only what the promotion allowlist promotes (2026-11-17) ─────
# Production held 42 versions on no list and one held-out version, each answered `ok` and linked into a
# member's chart with no grade (docs/pine/evidence/2026-11-17-library-store-fail-closed/EVIDENCE.md).

HELD_PATH = "PineCoders/ConditionalAverages/2"      # a `heldOut` row of the committed allowlist
# on no list. It was `TradingView/ta/7` (production held it, served `ok`) until ta/7 was promoted on 2026-11-19;
# `TradingView/ta/9` is another version production's store holds that no list names.
UNLISTED_PATH = "TradingView/ta/9"
STAND_IN = {HELD_PATH: "//@version=5\nlibrary(\"ConditionalAverages\")\nexport f() => 1\n",
            UNLISTED_PATH: "//@version=5\nlibrary(\"ta\")\nexport f() => 1\n"}
SENTENCE = "this library version is withheld until its drawing is verified against TradingView"


def assert_refused_by_name(path, status):
    """Every serving door refuses `path` by name: the store status, the read door's 409, the list,
    `read_entry`, and the server run's pins (`pine:library-denied`), each with the member's sentence."""
    assert store.entry_status(path) == (status, [SENTENCE])
    assert store.read_entry(path) is None
    assert path not in [e["path"] for e in store.list_entries()]
    r = _client().get("/api/pine/libraries/" + path)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == {"code": store.DENIED, "reason": SENTENCE}
    _, refusal = store.pinned_entries([{"path": path, "sha256": sha(STAND_IN.get(path, LIB))}])
    assert refusal == (store.DENIED_GUARD, "the library %s is not served: %s" % (path, SENTENCE))


def assert_served(path, source):
    assert store.entry_status(path)[0] == "ok"
    r = _client().get("/api/pine/libraries/" + path)
    assert r.status_code == 200 and r.json()["sha256"] == sha(source) and r.json()["source"] == source
    assert path in [e["path"] for e in store.list_entries()]
    got, why = store.pinned_entries([{"path": path, "sha256": sha(source)}])
    assert why is None and got[0]["sha256"] == sha(source)


def test_a_held_out_version_is_refused_by_name(root, monkeypatch):
    committed = json.load(open(COMMITTED_PROMOTION, encoding="utf-8"))
    assert HELD_PATH in {r["path"] for r in committed["heldOut"]}            # non-vacuity: it IS held out,
    assert HELD_PATH not in {r["path"] for r in committed["promote"]}        # not promoted,
    assert store.denied(HELD_PATH) is None                                   # and not on the deny list
    monkeypatch.setattr(store, "PROMOTION_FILE", COMMITTED_PROMOTION)
    store.write_entry(entry(path=HELD_PATH, source=STAND_IN[HELD_PATH]))
    assert store.stored_status(HELD_PATH)[0] == "ok"                         # a valid entry: what used to serve
    assert_refused_by_name(HELD_PATH, store.HELD)
    # control: the same entry, under an allowlist that promotes it at its sha, is served
    monkeypatch.setattr(store, "PROMOTION_FILE", write_promotion(
        os.path.join(root, "allow.json"), {"promote": [{"path": HELD_PATH, "sha256": sha(STAND_IN[HELD_PATH])}],
                                           "heldOut": []}))
    assert_served(HELD_PATH, STAND_IN[HELD_PATH])


def test_a_version_on_no_list_is_refused_by_name(root, monkeypatch):
    committed = json.load(open(COMMITTED_PROMOTION, encoding="utf-8"))
    listed = ({r["path"] for r in committed["promote"]} | {r["path"] for r in committed["heldOut"]}
              | set(committed["neverPromoted"]["paths"]))
    assert UNLISTED_PATH not in listed and store.denied(UNLISTED_PATH) is None   # non-vacuity
    monkeypatch.setattr(store, "PROMOTION_FILE", COMMITTED_PROMOTION)
    store.write_entry(entry(path=UNLISTED_PATH, source=STAND_IN[UNLISTED_PATH]))
    assert store.stored_status(UNLISTED_PATH)[0] == "ok"
    assert_refused_by_name(UNLISTED_PATH, store.UNPROMOTED)
    # a version the store does not hold is still a plain 404 (refused as missing, as before)
    assert store.entry_status("TradingView/ta/8") == ("missing", None)
    assert _client().get("/api/pine/libraries/TradingView/ta/8").status_code == 404
    # control: promoted at its sha, served
    monkeypatch.setattr(store, "PROMOTION_FILE", write_promotion(
        os.path.join(root, "allow.json"), {"promote": [{"path": UNLISTED_PATH, "sha256": sha(STAND_IN[UNLISTED_PATH])}]}))
    assert_served(UNLISTED_PATH, STAND_IN[UNLISTED_PATH])


def test_a_promoted_version_is_served_only_at_its_pinned_sha(root):
    # the autouse allowlist promotes tester/pinlib/1 at sha(LIB)
    store.write_entry(entry())
    assert_served("tester/pinlib/1", LIB)
    # the store now holds OTHER code under the promoted version: that code was never graded
    store.write_entry(entry(source=LIB_V2))
    assert store.stored_status("tester/pinlib/1")[0] == "ok"
    assert_refused_by_name("tester/pinlib/1", store.UNPROMOTED)
    # control: the graded code back, served again
    store.write_entry(entry())
    assert_served("tester/pinlib/1", LIB)


def test_the_served_set_is_derived_from_the_committed_allowlist():
    """ONE authority: the store's promoted map IS the committed file's `promote` rows, path -> sha256."""
    committed = json.load(open(COMMITTED_PROMOTION, encoding="utf-8"))
    want = {r["path"]: r["sha256"] for r in committed["promote"]}
    assert len(want) >= 6                                                   # non-vacuity (6 promoted 2026-11-17)
    assert store.promoted_versions(committed) == want
    with open(COMMITTED_PROMOTION, encoding="utf-8") as f:
        assert store.promoted_versions(json.load(f)) == want
    assert os.path.normcase(COMMITTED_PROMOTION) == os.path.normcase(
        os.path.join(REPO, "tools", "pine_library", "promotion_allowlist.json"))


@pytest.mark.parametrize("text", [
    None,                                                     # no file at all
    "not json at all",
    "[]",
    "{}",
    '{"promote": "tester/pinlib/1"}',
    '{"promote": [{"path": "tester/pinlib/1"}]}',             # a row with no sha256
    '{"promote": [{"sha256": "%s"}]}' % ("0" * 64),           # a row with no path
    '{"promote": [{"path": "not a path", "sha256": "%s"}]}' % ("0" * 64),
    '{"promote": [{"path": "tester/pinlib/1", "sha256": "%s"}, 5]}' % ("0" * 64),
], ids=["missing", "not-json", "a-list", "no-promote", "promote-not-a-list", "row-without-sha", "row-without-path",
        "bad-path", "row-not-an-object"])
def test_an_unreadable_allowlist_serves_nothing(root, monkeypatch, text):
    """FAIL CLOSED, whichever way the file is wrong: nothing is served, every stored version refused by name."""
    store.write_entry(entry())
    bad = os.path.join(root, "allow.json")
    if text is not None:
        with open(bad, "w", encoding="utf-8") as f:
            f.write(text)
    monkeypatch.setattr(store, "PROMOTION_FILE", bad)
    assert store.promoted_versions() is None
    assert_refused_by_name("tester/pinlib/1", store.UNPROMOTED)


def test_control_a_readable_allowlist_serves_exactly_what_it_promotes(root, monkeypatch):
    store.write_entry(entry())
    store.write_entry(entry(path="tester/pinlib/2"))
    ok = os.path.join(root, "allow.json")
    monkeypatch.setattr(store, "PROMOTION_FILE", write_promotion(ok, {
        "promote": [{"path": "tester/pinlib/1", "sha256": sha(LIB)}], "heldOut": [{"path": "tester/pinlib/2"}]}))
    assert_served("tester/pinlib/1", LIB)
    assert_refused_by_name("tester/pinlib/2", store.HELD)
    write_promotion(ok, {"promote": []})                    # readable and empty: nothing promoted, nothing served
    assert store.promoted_versions() == {}
    assert_refused_by_name("tester/pinlib/1", store.UNPROMOTED)


def test_the_owner_tools_still_see_what_the_store_holds(root, monkeypatch, capsys):
    """`fetch_library` must not re-fetch (and overwrite) a version it holds because it is not promoted, and
    `promotion_check` must name every other version by the status this server now serves it with."""
    monkeypatch.setattr(store, "PROMOTION_FILE", COMMITTED_PROMOTION)
    store.write_entry(entry(path=UNLISTED_PATH, source=STAND_IN[UNLISTED_PATH]))
    store.write_entry(entry(path=HELD_PATH, source=STAND_IN[HELD_PATH]))
    assert store.stored_entry(UNLISTED_PATH)["source"] == STAND_IN[UNLISTED_PATH]
    assert [e["path"] for e in store.list_entries(served=False)] == [HELD_PATH, UNLISTED_PATH]
    assert store.list_entries() == []
    from tools.pine_library import fetch_library

    def no_fetch(*_a, **_k):
        raise AssertionError("re-fetched a version the store holds")
    monkeypatch.setattr(fetch_library, "fetch", no_fetch)
    assert fetch_library.main([UNLISTED_PATH]) == 0                     # held: no network, nothing written
    assert "have  %s" % UNLISTED_PATH in capsys.readouterr().out
    _problems, lines = _promotion_check().check(root, json.load(open(COMMITTED_PROMOTION, encoding="utf-8")))
    assert "OTHER     %s  held out, store status held" % HELD_PATH in lines
    assert "OTHER     %s  not on the allowlist, store status unpromoted" % UNLISTED_PATH in lines
