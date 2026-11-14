"""`web` restarts only for the frontend files it actually uses, and never misses one.

Since 2026-11-14 members get the built frontend from the front door (`web-front`), so `railway.web.json`
watches the frontend files the Python backend reads or runs (about fifty), not all of `app/**`
(about ten thousand). These tests are what make that safe:

  * every file `tools/web_frontend_reads.py` says `web` needs is matched by a watch pattern;
  * no Python file refers to a path under `app/` that the tool does not account for, so a new
    backend read of a frontend file cannot be merged without being added (and therefore watched);
  * the JavaScript `web` runs under node is followed through every relative import, JSON included.

No Railway, no network, no application imports: they read files.

Mutation proof (run before calling these done):
    1. a needed file dropped from railway.web.json           -> test_every_file_web_needs_is_watched RED
    2. a declared read removed from DECLARED_READS            -> test_no_python_refers_to_an_app_path_the_tool_does_not_know RED
    3. `js_closure` stops following imports                  -> test_the_node_lane_closure_reaches_its_json_and_its_helpers RED
    4. `python_references` ignores `/`-built paths           -> test_the_scan_sees_reads_written_each_way RED
    5. `unwatched` lets `*` cross a folder                    -> test_watch_patterns_match_like_railway_matches RED
"""
from __future__ import annotations

import json
import os

import pytest

from tools import web_frontend_reads as wfr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _patterns() -> list[str]:
    with open(os.path.join(ROOT, "railway.web.json"), encoding="utf-8") as f:
        return json.load(f)["build"]["watchPatterns"]


# ── the real repo ─────────────────────────────────────────────────────────────

def test_every_file_web_needs_is_watched():
    needed = wfr.needed(ROOT)
    assert len(needed) >= 40, f"only {len(needed)} needed files: the reader has gone blind"
    missing = wfr.unwatched(_patterns(), needed)
    assert not missing, ("web needs these at runtime and railway.web.json does not watch them, so a change to one "
                         "would leave web running the old copy:\n  " + "\n  ".join(missing))


def test_no_python_refers_to_an_app_path_the_tool_does_not_know():
    found = wfr.undeclared(ROOT)
    assert not found, ("these Python files refer to a path under app/ that tools/web_frontend_reads.py does not "
                       "account for. If web reads it at runtime add it to DECLARED_READS (it then has to be watched); "
                       "if not, add the file to NOT_RUNTIME or the pair to IGNORED_MENTIONS with a reason:\n  "
                       + "\n  ".join(f"{py}: {path}" for py, path in found))


def test_every_listed_path_exists():
    for path in [*wfr.DECLARED_READS, *wfr.NODE_ENTRIES, *wfr.BUILD_FILES, *wfr.NOT_RUNTIME, *wfr.EXTRA_PYTHON,
                 *(py for py, _ in wfr.IGNORED_MENTIONS), *(p for _, p in wfr.IGNORED_MENTIONS)]:
        assert os.path.exists(os.path.join(ROOT, path)), f"{path} is listed but does not exist"


def test_the_node_lane_closure_reaches_its_json_and_its_helpers():
    closure = wfr.js_closure(["app/src/components/chart/engine/ast/interpret.js"], ROOT)
    for must in ("app/src/components/chart/engine/ast/parse.js",
                 "app/src/components/chart/engine/ast/closedTable.json",
                 "app/src/lib/marketClock/market_calendar.json",
                 "app/src/components/chart/indicators.js"):
        assert must in closure, must
    cot = wfr.js_closure(["app/src/pages/cot/cotFactsEntry.js"], ROOT)
    assert len(cot) >= 5 and all(p.startswith("app/src/pages/cot/") for p in cot)


def test_the_scan_sees_reads_written_each_way():
    """Non-vacuity on the real code: three reads, written three different ways."""
    def refs(rel):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            return wfr.python_references(f.read())
    assert "app/src/utils/barsIDB.js" in refs("api/main.py")                                  # Path / "app" / ...
    assert "app/src/lib/taxonomy/a8Taxonomy.json" in refs("api/services/a8_taxonomy.py")
    assert any(r.startswith("app/public") for r in refs("api/main.py"))                        # os.path.join(..., "app", "public")


def test_the_list_is_what_makes_the_saving():
    """The point of the list: a frontend-only change no longer restarts web. If you put `app/**` back on
    purpose (for example after moving the domain back to web), change this test in the same commit."""
    patterns = _patterns()
    assert "app/**" not in patterns
    assert wfr.unwatched(patterns, ["app/src/pages/Dashboard.jsx", "app/src/styles/tokens.css", "app/index.html"]) == [
        "app/index.html", "app/src/pages/Dashboard.jsx", "app/src/styles/tokens.css"]
    for kept in ("api/**", "requirements*.txt", "railway*.json", "Dockerfile.web"):
        assert kept in patterns, kept
    assert wfr.unwatched(patterns, ["front/service.json"]) == ["front/service.json"], "the front door's config must not restart web"


# ── the pieces ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("pattern,path,matches", [
    ("app/**", "app/src/a/b.js", True),
    ("api/**", "app/src/a/b.js", False),
    ("app/src/*", "app/src/a.js", True),
    ("app/src/*", "app/src/x/a.js", False),
    ("/railway.json", "railway.json", True),
    ("railway*.json", "railway.web.json", True),
    ("requirements*.txt", "requirements-dev.txt", True),
    ("app/src/a.json", "app/src/a.jsonx", False),
    ("**/x.js", "app/src/x.js", True),
])
def test_watch_patterns_match_like_railway_matches(pattern, path, matches):
    assert (wfr.unwatched([pattern], [path]) == []) is matches


def test_an_unresolvable_import_is_an_error_not_a_silent_skip(tmp_path):
    (tmp_path / "a.js").write_text("import { x } from './missing.js'\n", encoding="utf-8")
    with pytest.raises(FileNotFoundError, match="missing.js"):
        wfr.js_closure(["a.js"], str(tmp_path))


def test_bare_packages_and_node_builtins_are_not_followed(tmp_path):
    (tmp_path / "a.js").write_text("import jsep from 'jsep'\nimport fs from 'node:fs'\nimport b from './b'\n", encoding="utf-8")
    (tmp_path / "b.js").write_text("const c = require('./c.json')\n", encoding="utf-8")
    (tmp_path / "c.json").write_text("{}", encoding="utf-8")
    assert wfr.js_closure(["a.js"], str(tmp_path)) == {"a.js", "b.js", "c.json"}


def test_self_check_passes():
    lines = []
    assert wfr.self_check(lines.append) == 0, lines
