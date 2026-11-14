"""Which frontend files does the main server (`web`) need at runtime, and does its watch list cover them?

WHY. Since 2026-11-14 members get the built frontend from the front door (`web-front`), so `web`
no longer has to restart for a frontend-only change. It still restarts for every one, because its
watch list says `app/**`. That entry cannot simply be removed: the Python backend opens about two
dozen files under `app/` directly, runs a few more under node, and builds one bundle from others.
A change to any of those MUST still redeploy `web`, or it keeps running on the old copy in silence.

This tool is the list of those files and the check that `web`'s watch list covers every one:

  DECLARED_READS   files Python opens by path (found by reading the code; each names its reader)
  NODE_ENTRIES     JavaScript `web` runs under node, with everything those files import
  BUILD_FILES      what decides how the bundles `web` runs are built

    python tools/web_frontend_reads.py                # is every needed file watched? exit 0 yes / 1 no
    python tools/web_frontend_reads.py --list         # the needed files, one per line, with the reason
    python tools/web_frontend_reads.py --undeclared   # app/ paths Python mentions that this file does not know
    python tools/web_frontend_reads.py --self-check

`tests/test_web_frontend_reads.py` runs both checks: the watch list covers the needed files, and
no Python file refers to a path under `app/` that is neither declared here as a runtime read nor
listed in NOT_RUNTIME with a reason. So a new backend read of a frontend file cannot be merged
without a decision about it.

The watch list is `build.watchPatterns` in `railway.web.json` (and, after 2026-12-01, Railway's
stored copy of it: `tools/railway_stored_settings.py` keeps the two equal).
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
import warnings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WATCH_FILE = "railway.web.json"

#: app/ path -> the Python that opens it at runtime. Kept by hand, checked by `undeclared()`.
DECLARED_READS = {
    "app/src/utils/barsIDB.js": "api/main.py: CACHE_LOGIC_VERSION for the startup fingerprint",
    "app/src/utils/barsBackfill.js": "api/services/discord_chart_house.py: bar depths for Discord chart warming",
    "app/public/flow-data.csv": "api/main.py: seeds flow.db at boot",
    "app/public/Indexes-data.csv": "api/main.py: seeds flow.db at boot, and GET /Indexes-data.csv",
    "app/public/Darkpool-data.csv": "api/main.py: seeds the dark-pool DB at boot, and GET /Darkpool-data.csv",
    "app/public/massive-card-logo.png": "api/main.py: GET /api/brand/massive-card-logo.png",
    "app/src/lib/marketClock/market_calendar.json": "api/services/session_calendar.py: the NYSE session calendar",
    "app/src/lib/taxonomy/a8Taxonomy.json": "api/services/a8_taxonomy.py: catalyst tag vocabulary",
    "app/src/components/chart/engine/ast/closedTable.json": "api/services/ast_lint.py, ast_table.py, conversation_preflight.py: the formula table",
    "app/src/components/chart/engine/ast/conceptVocabulary.json": "api/services/concept_vocabulary.py",
    "app/src/components/chart/engine/ast/symbolScope.json": "api/services/ast_bind.py",
    "app/src/components/chart/builder/authoring/preflightRules.json": "api/services/conversation_preflight.py",
    "app/src/components/chart/builder/authoring/crossContext.json": "api/services/conversation_preflight.py, definition_conversation.py",
    "app/src/components/chart/builder/authoring/patchSchema.json": "api/services/definition_conversation.py",
    "app/src/constants/setupGroups.js": "api/services/concept_vocabulary.py: firm setup names",
    "app/src/constants/quotes.json": "api/services/quote_of_the_day.py",
    "app/src/pages/modelbook/setupCatalog.js": "api/services/concept_vocabulary.py, wisdom/publish/adapters/modelbook.py",
    "app/src/pages/modelbook/setupPlaybooks.js": "api/services/wisdom/publish/adapters/modelbook.py",
    "app/src/pages/charts/boardBound.json": "api/services/board_bound.py: widgets per board",
    "app/src/components/chart/engine/runtime/runtimeRepaint.json": "api/services/runtime_repaint.py",
    "app/src/components/chart/engine/runtime/ir.js": "api/services/pine_runtime_client.py: engine identity",
    "app/src/components/chart/engine/ast/pineRuntimeFrontend.js": "api/services/pine_runtime_client.py: engine identity",
    "app/src/components/chart/supportLoop/pineBuiltins.json": "api/services/indicator_support.py",
    "app/src/components/chart/supportLoop/doorNameCoverage.json": "api/services/indicator_support_loop.py",
    "app/src/components/chart/engine/scriptEngineVersion.js": "api/services/user_definitions.py: SCRIPT_ENGINE_VERSION",
}

#: JavaScript `web` runs under node. Each entry is needed together with everything it imports.
NODE_ENTRIES = {
    "app/src/components/chart/engine/ast/interpret.js": "run from source by node when a user-formula alert is armed (tools/ast_conformance.py)",
    "app/src/components/chart/engine/ast/parse.js": "run from source by node (tools/ast_conformance.py)",
    "app/src/pages/cot/cotFactsEntry.js": "bundled into app/dist/cot-facts.cjs, which api/services/cot_prewarm.py runs",
    "app/src/pages/optionsFlow/flowFactsEntry.js": "bundled into app/dist/flow-facts.cjs; web runs it whenever FLOW_READS_PROXY_ENABLED is off",
}

#: What decides how those bundles are built and which packages node finds.
BUILD_FILES = {
    "app/package.json": "node reads its \"type\"; it pins esbuild and the packages copied into the image",
    "app/package-lock.json": "the exact esbuild and jsep versions",
    "app/scripts/build-cot-facts.mjs": "builds app/dist/cot-facts.cjs",
    "app/scripts/build-flow-facts.mjs": "builds app/dist/flow-facts.cjs",
}

#: Python files that mention a path under app/ and do NOT open it while `web` serves. Each needs a reason.
NOT_RUNTIME = {
    "api/services/uct_agent/scan/hidden.py": "writes scanHidden.js only under `__main__ --write`",
    "api/services/starter_library.py": "imported only by tests",
    "api/services/wisdom/core/bans.py": "a development rail over path names; nothing imports it at runtime",
    "api/services/journal_two/tools_emit_parity_fixtures.py": "a generator that writes fixtures, run by hand",
    "api/services/journal_two/note_connectors/corpora/corpora_gen.py": "a generator, run by hand",
    "api/services/journal_two/note_connectors/convert/fixtures_gen.py": "a generator, run by hand",
    "api/services/journal_two/note_connectors/convert/deep_nesting_cases.py": "a generator, run by hand",
    "api/services/journal_two/note_connectors/convert/enml_parity_fixtures_gen.py": "a generator, run by hand",
    "api/services/journal_two/note_connectors/convert/obsidian_parity_fixtures_gen.py": "a generator, run by hand",
    "tools/alert_replay.py": "its parity bars are reached only from a corpus helper, not from arming an alert",
}

#: Single mentions that are not runtime reads, in files that may hold real ones. (file, path) -> reason.
IGNORED_MENTIONS = {
    ("api/services/pine_capabilities.py", "app/src/components/chart/engine/ast/pine.js"):
        "read only by `usage_of`, the census; nothing at runtime calls it",
}

#: Python outside `api/` that `web` runs.
EXTRA_PYTHON = ("tools/ast_conformance.py", "tools/alert_replay.py")

_IMPORT = re.compile(
    r"""(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]"""
    r"""|(?:^|\n)\s*import\s*['"]([^'"]+)['"]"""
    r"""|import\(\s*['"]([^'"]+)['"]\s*\)"""
    r"""|require\(\s*['"]([^'"]+)['"]\s*\)""")


# ── JavaScript: an entry and everything it imports ────────────────────────────

def js_closure(entries, root: str = ROOT) -> set[str]:
    """Repo-relative paths of `entries` and every source or JSON file they import, transitively.
    Relative imports only: a bare package is the image's business, not the watch list's."""
    seen: set[str] = set()
    todo = [os.path.normpath(os.path.join(root, e)) for e in entries]
    while todo:
        path = todo.pop()
        rel = os.path.relpath(path, root).replace(os.sep, "/")
        if rel in seen:
            continue
        if not os.path.isfile(path):
            raise FileNotFoundError(f"{rel} is listed or imported but does not exist")
        seen.add(rel)
        if path.endswith(".json"):
            continue
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for m in _IMPORT.finditer(text):
            spec = next(g for g in m.groups() if g)
            if not spec.startswith("."):
                continue
            base = os.path.normpath(os.path.join(os.path.dirname(path), spec))
            for candidate in (base, base + ".js", base + ".mjs", base + ".jsx", os.path.join(base, "index.js")):
                if os.path.isfile(candidate):
                    todo.append(candidate)
                    break
            else:
                raise FileNotFoundError(f"{rel}: the import {spec!r} resolves to no file")
    return seen


def needed(root: str = ROOT) -> dict[str, str]:
    """Every file under app/ that `web` needs at runtime -> why."""
    out = dict(DECLARED_READS)
    for entry, why in NODE_ENTRIES.items():
        for path in sorted(js_closure([entry], root)):
            out.setdefault(path, why if path == entry else f"imported by {entry.rsplit('/', 1)[1]}: {why}")
    out.update({k: v for k, v in BUILD_FILES.items() if k not in out})
    return out


# ── the watch list ────────────────────────────────────────────────────────────

def _pattern_regex(pattern: str) -> re.Pattern:
    """Railway watch patterns are gitignore-style: `**` crosses folders, `*` stays inside one."""
    pattern = pattern.lstrip("/")
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            out, i = out + ".*", i + 2
        elif pattern[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif pattern[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile("^" + out + "$")


def unwatched(patterns, paths) -> list[str]:
    """The paths no pattern matches."""
    compiled = [_pattern_regex(p) for p in patterns]
    return sorted(p for p in paths if not any(c.match(p) for c in compiled))


def watch_patterns(root: str = ROOT) -> list[str]:
    with open(os.path.join(root, WATCH_FILE), encoding="utf-8") as f:
        return list((json.load(f).get("build") or {}).get("watchPatterns") or [])


# ── Python: every mention of a path under app/ ────────────────────────────────

_LITERAL = re.compile(r"(?:^|[^\w./-])(app/(?:src|public|scripts)/[\w./\-]+|app/package(?:-lock)?\.json)")


def _docstrings(tree: ast.AST) -> set[int]:
    """Every string standing alone as a statement: docstrings, and the triple-quoted blocks some
    modules use as comments. Neither has any effect at runtime."""
    return {id(node.value) for node in ast.walk(tree)
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)}


def _segments(node: ast.AST):
    """The string pieces of `os.path.join(a, "app", "src", ...)` or `x / "app" / "src" / ...`, in order."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        return _segments(node.left) + _segments(node.right)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("join", "joinpath"):
        out = []
        for arg in node.args:
            out += _segments(arg)
        return out
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [node.value]
    return [None]          # a name, a call: not a literal piece


def python_references(source: str) -> set[str]:
    """Paths under app/ that a Python source builds or names in CODE (docstrings and comments ignored)."""
    tree = ast.parse(source)
    docs = _docstrings(tree)
    inner: set[int] = set()          # pieces of a longer path expression: only the whole one counts
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            inner.update((id(node.left), id(node.right)))
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("join", "joinpath"):
            inner.update(id(a) for a in node.args)
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docs:
            for m in _LITERAL.finditer(" " + node.value):
                found.add(m.group(1).rstrip("./"))
        if isinstance(node, (ast.BinOp, ast.Call)) and id(node) not in inner:
            pieces = _segments(node)
            for i, piece in enumerate(pieces):
                if piece == "app" and i + 1 < len(pieces) and pieces[i + 1] in ("src", "public", "scripts", "package.json", "package-lock.json"):
                    tail = []
                    for nxt in pieces[i + 1:]:
                        if nxt is None:
                            break
                        tail.append(nxt.strip("/"))
                    found.add("/".join(["app"] + tail))
    return found


def python_files(root: str = ROOT) -> list[str]:
    out = []
    for folder, _dirs, files in os.walk(os.path.join(root, "api")):
        for name in files:
            if name.endswith(".py") and not name.startswith("test_") and name != "conftest.py":
                out.append(os.path.relpath(os.path.join(folder, name), root).replace(os.sep, "/"))
    return sorted(out) + [p for p in EXTRA_PYTHON if os.path.isfile(os.path.join(root, p))]


def undeclared(root: str = ROOT) -> list[tuple[str, str]]:
    """(python file, app path) for every mention that is neither a declared runtime read, nor inside
    a folder that holds one, nor in a file listed in NOT_RUNTIME."""
    known = set(needed(root))
    out = []
    for rel in python_files(root):
        if rel in NOT_RUNTIME:
            continue
        with open(os.path.join(root, rel), encoding="utf-8") as f:
            text = f.read()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)       # an old escape in someone else's string
            refs = python_references(text)
        for ref in sorted(refs):
            if not os.path.exists(os.path.join(root, ref)):
                continue                                   # a URL fragment or a path that is not in the repo
            is_folder = os.path.isdir(os.path.join(root, ref))
            covered = ref in known or (is_folder and any(k.startswith(ref + "/") for k in known))
            if not covered and (rel, ref) not in IGNORED_MENTIONS:
                out.append((rel, ref))
    return out


# ── the commands ──────────────────────────────────────────────────────────────

def self_check(out=print) -> int:
    paths = ["app/src/a/b.json", "app/src/a/c/d.js", "app/package.json", "api/main.py"]
    cases = [
        ("`app/**` covers everything under app", unwatched(["app/**"], paths) == ["api/main.py"]),
        ("a folder pattern leaves the other folders out", unwatched(["app/src/a/c/**", "api/**"], paths) == ["app/package.json", "app/src/a/b.json"]),
        ("`*` does not cross a folder", unwatched(["app/src/a/*"], paths[:2]) == ["app/src/a/c/d.js"]),
        ("a leading slash is the repo root", unwatched(["/app/package.json"], ["app/package.json"]) == []),
        ("an exact file matches only itself", unwatched(["app/src/a/b.json"], paths[:2]) == ["app/src/a/c/d.js"]),
        ("a path built with os.path.join is seen", python_references('import os\nP = os.path.join(BASE, "app", "src", "x", "y.json")\n') == {"app/src/x/y.json"}),
        ("a path built with / is seen", python_references('P = ROOT / "app" / "public" / "z.csv"\n') == {"app/public/z.csv"}),
        ("a literal path is seen", python_references('open("app/src/q/r.js")\n') == {"app/src/q/r.js"}),
        ("a docstring is not code", python_references('def f():\n    """see app/src/q/r.js"""\n    return 1\n') == set()),
        ("a string standing alone as a comment is not code", python_references('X = 1\n"""see app/src/q/r.js"""\n') == set()),
        ("a folder constant later joined is seen as the folder",
         python_references('import os\nP = os.path.join(B, "app", "public")\nQ = os.path.join(P, "a.png")\n') == {"app/public"}),
    ]
    ok = all(passed for _, passed in cases)
    for label, passed in cases:
        out(f"  {'ok  ' if passed else 'FAIL'} {label}")
    out("self-check passed" if ok else "self-check FAILED")
    return 0 if ok else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--list", action="store_true")
    p.add_argument("--undeclared", action="store_true")
    p.add_argument("--self-check", action="store_true")
    args = p.parse_args(argv)
    if args.self_check:
        return self_check()
    if args.undeclared:
        found = undeclared()
        for rel, ref in found:
            print(f"{rel}: {ref}")
        print(f"{len(found)} mention(s) of a path under app/ that this tool does not account for")
        return 1 if found else 0
    files = needed()
    if args.list:
        for path in sorted(files):
            print(f"{path}\t{files[path]}")
        return 0
    patterns = watch_patterns()
    missing = unwatched(patterns, files)
    print(f"web needs {len(files)} files under app/ at runtime; its watch list has {len(patterns)} patterns")
    for path in missing:
        print(f"  NOT WATCHED {path}   ({files[path]})")
    print("RESULT: every one is watched" if not missing else
          f"RESULT: {len(missing)} needed file(s) are not watched: a change to one would not redeploy web")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
