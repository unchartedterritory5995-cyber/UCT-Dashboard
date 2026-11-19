"""Which engine tests are WHOLE-APP rails, and does the `whole-app engine rails` job run every one of them?

    python tools/ci_whole_app_rails.py --check --captures DIR --expected expected.txt --root app \
        [--must-include app/src/...test.js ...] [--report out.json]
    python tools/ci_whole_app_rails.py --derive --captures DIR      # print the list the captures imply
    python tools/ci_whole_app_rails.py --verify-list                # the list names real test files, once each
    python tools/ci_whole_app_rails.py --print-list                 # the list, for `vitest run` (app-relative)
    python tools/ci_whole_app_rails.py --ran report.json            # a vitest JSON report ran every listed file
    python tools/ci_whole_app_rails.py --self-check                 # the check can fail, both ways

WHY (2026-11-17). Some tests under app/src/components/chart/engine/ read files OUTSIDE it: memberPaneGate walks
the import graph from src/main.jsx, suiteCoverage lists the test folders under components/chart, three source
rails import StockChart.jsx as text. They ran only in pine heavy, which triggers on engine paths, so #1662
(pages/formulas) and #1670 (builder/inspect) merged green while breaking them, and the NEXT engine PRs went red
on someone else's change. The `whole-app engine rails` workflow runs exactly these rails on every PR that
touches app/src/**; this tool keeps its list (tools/whole_app_engine_rails.txt) DERIVED, never hand-kept alone.

WHAT A READ IS, and where it comes from:
  * RUNTIME (pine heavy's legs, UCT_READ_CAPTURE_DIR): every path a test file hands to a node:fs read door
    (read, readdir, exists, stat, access, opendir, streams, promises) or names as a program to spawn, and every
    path a node child process it starts reads (app/src/test-read-capture.cjs). One JSON-lines file per test file and
    process: a header {schema, file, kind, pid, cwd}, then one JSON string per path, written as it is read.
  * STATIC (this tool, over the checkout): a `?raw` / `?url` import, which vite reads as TEXT in the main
    process where no fs wrapper can see it, followed through the relative imports of the engine's own files (a
    helper that imports a `?raw` charges every test that imports the helper). `import.meta.glob` is not
    modelled: any use under engine/ is an error here until it is.
  Comments are stripped before the static scan: CODE, NEVER PROSE.

A read is EXTERNAL when its repo-relative path is not covered by pine heavy's own `pull_request.paths` (read
from the workflow, never retyped): a PR touching it would not run the test that reads it. Ignored: paths outside
the repo, under node_modules or .git, and the CI scratch directories the legs write (SCRATCH).
A WHOLE-APP RAIL is an engine test file with at least one external read.

--check fails (exit 1), naming every file, when:
  * a whole-app rail is missing from the list                      (the hole this exists to close)
  * a listed file is no whole-app rail any more, or was not captured (a list that drifts is a list nobody trusts)
  * an external read of a listed rail is covered by neither workflow's trigger paths
                                                                   (the rail runs, but not on the PR that breaks it)
  * an expected engine test file has no capture record, or a --must-include file is no whole-app rail
                                                                   (a capture that recorded nothing passes everything)
Exit 2: the inputs could not be read.

Standard library + PyYAML.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import tempfile

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENGINE = "app/src/components/chart/engine/"
LIST = ROOT / "tools" / "whole_app_engine_rails.txt"
PINE_HEAVY = ROOT / ".github" / "workflows" / "pine-heavy.yml"
WHOLE_APP_WF = ROOT / ".github" / "workflows" / "whole-app-engine-rails.yml"
SCHEMA = "uct.read-capture/v1"
#: written by the CI jobs themselves next to the checkout (pine-heavy.yml: reports, harness-out, read-capture,
#: the $CI_TOOLS checkout; the union job's downloads). Never a source a PR can change.
SCRATCH = frozenset({".git", ".pine-heavy-ci", "reports", "harness-out", "read-capture", "shards", "harness",
                     "ratchet-out", "captures", "whole-app-out"})
_SRC_EXT = (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx")
_TEXT_IMPORT = re.compile(r"""(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"\n]+?)\?(?:raw|url)['"]""")
_REL_IMPORT = re.compile(r"""(?:from\s*|import\s*\(\s*|require\(\s*|import\s+)['"](\.{1,2}/[^'"\n?]+)['"]""")
_GLOB_IMPORT = re.compile(r"import\.meta\.glob(?:Eager)?\s*\(")


# ── paths and triggers ──────────────────────────────────────────────────────────────────────────────────────────

def glob_rx(g: str) -> re.Pattern:
    """A GitHub `paths` filter pattern as a regex: `**` crosses `/`, `*` and `?` do not."""
    out, i = "", 0
    while i < len(g):
        if g.startswith("**", i):
            out, i = out + ".*", i + 2
        elif g[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif g[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(g[i]), i + 1
    return re.compile(out + r"\Z")


def pr_paths(workflow: pathlib.Path) -> list[str]:
    doc = yaml.safe_load(workflow.read_text(encoding="utf-8"))
    on = doc.get("on", doc.get(True)) or {}
    paths = ((on.get("pull_request") or {}).get("paths")) or []
    if not paths:
        raise ValueError(f"{workflow.name}: no pull_request.paths to read")
    return [str(p) for p in paths]


def covered(rel: str, rxs: list[re.Pattern]) -> bool:
    """A file, or a directory whose listing changes when a file is added under it."""
    return any(rx.match(rel) or rx.match(rel + "/x") for rx in rxs)


def relevant(rel: str) -> bool:
    parts = rel.split("/")
    # (a Windows drive path a rail probes for the owner's machine resolves INSIDE the checkout on Linux:
    # `app/C:/Users/...`; no repo path has a ':' in a segment, so no PR can create one)
    return (bool(rel) and parts[0] not in SCRATCH and "node_modules" not in parts
            and not any(re.fullmatch(r"[A-Za-z]:", p) for p in parts))


# ── the runtime captures ────────────────────────────────────────────────────────────────────────────────────────

def _norm(p: str) -> str:
    return str(p).replace("\\", "/")


def read_record(f: pathlib.Path) -> tuple[dict, list[str]] | None:
    """One capture file: a header line, then one JSON string per path (a torn last line is skipped)."""
    lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
    if not lines:
        return None
    try:
        head = json.loads(lines[0])
    except ValueError:
        return None
    if not isinstance(head, dict) or head.get("schema") != SCHEMA:
        return None
    reads = []
    for l in lines[1:]:
        try:
            v = json.loads(l)
        except ValueError:
            continue
        if isinstance(v, str):
            reads.append(v)
    return head, reads


def load_captures(captures: pathlib.Path) -> dict[str, set[str]]:
    """{test file (repo-relative): {read (repo-relative)}}, merged over every process that ran the file."""
    out: dict[str, set[str]] = {}
    files = sorted(captures.rglob("*.jsonl"))
    if not files:
        raise FileNotFoundError(f"no read-capture records under {captures}")
    for f in files:
        rec = read_record(f)
        if rec is None:
            continue
        head, raw = rec
        test = _norm(head["file"])
        cut = test.find("/app/src/")
        if cut < 0:
            continue
        root = test[:cut] + "/"
        reads = out.setdefault(test[len(root):], set())
        for r in raw:
            r = _norm(r)
            if r.startswith(root):
                rel = r[len(root):].rstrip("/")
                if relevant(rel):
                    reads.add(rel)
    return out


# ── the static half: text imports vite reads in the main process ────────────────────────────────────────────────

def _code(text: str) -> str:
    """The source with comments removed: a rail that hunts an import must not find it in prose."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("//"))


def _resolve(importer: pathlib.Path, spec: str) -> pathlib.Path | None:
    base = importer.parent / spec
    for cand in [base] + [base.with_name(base.name + e) for e in _SRC_EXT] + [base / ("index" + e) for e in _SRC_EXT]:
        if cand.is_file():
            return cand.resolve()
    return None


def static_text_reads(repo: pathlib.Path = ROOT) -> tuple[dict[str, set[str]], list[str]]:
    """({engine test file: {repo-relative file it imports as text, directly or through an engine helper}},
    [engine files that use import.meta.glob])."""
    eng = repo / ENGINE
    files = [f.resolve() for f in eng.rglob("*") if f.suffix in _SRC_EXT and f.is_file() and "node_modules" not in f.parts]
    code = {f: _code(f.read_text(encoding="utf-8", errors="replace")) for f in files}
    rel = lambda p: p.resolve().relative_to(repo.resolve()).as_posix()  # noqa: E731
    direct: dict[pathlib.Path, set[str]] = {}
    globbers = []
    for f, c in code.items():
        if _GLOB_IMPORT.search(c):
            globbers.append(rel(f))
        hits = {rel(t) for t in (_resolve(f, s) for s in _TEXT_IMPORT.findall(c)) if t}
        if hits:
            direct[f] = hits
    imports = {f: {t for t in (_resolve(f, m) for m in _REL_IMPORT.findall(c)) if t and t in code} for f, c in code.items()}
    reach = {f: set(v) for f, v in direct.items()}
    grew = True
    while grew:                                     # importers, transitively, within the engine
        grew = False
        for f, targets in imports.items():
            add = set().union(*(reach[t] for t in targets if t in reach)) if targets else set()
            if add - reach.get(f, set()):
                reach.setdefault(f, set()).update(add)
                grew = True
    tests = {rel(f): v for f, v in reach.items() if ".test." in f.name}
    return tests, sorted(globbers)


# ── derive and judge ───────────────────────────────────────────────────────────────────────────────────────────

def derive(captured: dict[str, set[str]], static: dict[str, set[str]], pine_globs: list[str]) -> dict[str, list[str]]:
    """{whole-app rail (repo-relative): [its external reads]}."""
    rxs = [glob_rx(g) for g in pine_globs]
    out = {}
    for test in sorted(set(captured) | set(static)):
        if not test.startswith(ENGINE):
            continue
        ext = sorted(r for r in captured.get(test, set()) | static.get(test, set()) if not covered(r, rxs))
        if ext:
            out[test] = ext
    return out


def read_list(path: pathlib.Path = LIST) -> list[str]:
    """The list's entries, app-relative (as `vitest run` in app/ takes them)."""
    lines = [l.split("#", 1)[0].strip() for l in path.read_text(encoding="utf-8").splitlines()]
    return [l for l in lines if l]


def _app_rel(repo_rel: str) -> str:
    return repo_rel[len("app/"):] if repo_rel.startswith("app/") else repo_rel


def judge(rails: dict[str, list[str]], captured: set[str], listed: list[str], expected: list[str],
          whole_app_globs: list[str], must_include: list[str]) -> list[str]:
    """Every problem, as a line. Empty = the list is exactly the whole-app rails and every read triggers it."""
    bad = []
    listed_repo = ["app/" + l for l in listed]
    missing_capture = sorted(set(e for e in expected if e.startswith(ENGINE)) - captured)
    if not expected:
        bad.append("the expected file list is empty: nothing says which engine files the capture had to see")
    if missing_capture:
        bad.append(f"{len(missing_capture)} engine test file(s) ran with no read-capture record (the capture did not "
                   "run, or could not write):\n    " + "\n    ".join(missing_capture[:20]))
    for m in must_include:
        if m not in rails:
            bad.append(f"control {m} is not a whole-app rail in these captures: the capture is not seeing reads")
    for test in sorted(set(rails) - set(listed_repo)):
        ex = ", ".join(rails[test][:3]) + (f" (+{len(rails[test]) - 3} more)" if len(rails[test]) > 3 else "")
        bad.append(f"MISSING from {LIST.relative_to(ROOT).as_posix()}: {_app_rel(test)} reads outside pine heavy's "
                   f"trigger paths ({ex})")
    for l in listed_repo:
        if l not in captured:
            bad.append(f"LISTED but not captured: {_app_rel(l)} (renamed or deleted? the list must name real files)")
        elif l not in rails:
            bad.append(f"LISTED but no whole-app rail: {_app_rel(l)} reads nothing outside pine heavy's triggers "
                       "(remove it from the list)")
    rxs = [glob_rx(g) for g in whole_app_globs]
    for test in sorted(set(rails) & set(listed_repo)):
        un = [r for r in rails[test] if not covered(r, rxs)]
        if un:
            bad.append(f"UNTRIGGERED: {_app_rel(test)} reads {', '.join(un[:5])}"
                       + (f" (+{len(un) - 5} more)" if len(un) > 5 else "")
                       + f", which no pull_request.paths of {WHOLE_APP_WF.name} or pine-heavy.yml covers")
    return bad


# ── the list file and a run of it ───────────────────────────────────────────────────────────────────────────────

def verify_list(listed: list[str], repo: pathlib.Path = ROOT) -> list[str]:
    bad = []
    if len(listed) < 2:
        bad.append(f"the list holds {len(listed)} file(s): a list this short is a list that lost its contents")
    dup = sorted({l for l in listed if listed.count(l) > 1})
    if dup:
        bad.append(f"listed twice: {dup}")
    for l in listed:
        p = repo / "app" / l
        if not (("app/" + l).startswith(ENGINE) and ".test." in p.name and p.is_file()):
            bad.append(f"not an existing engine test file: {l}")
    return bad


def ran_every_listed(report: pathlib.Path, listed: list[str], app_root: pathlib.Path) -> list[str]:
    doc = json.loads(report.read_text(encoding="utf-8"))
    ran = set()
    for t in doc.get("testResults") or []:
        name = _norm(t["name"])
        root = _norm(str(app_root.resolve())).rstrip("/") + "/"
        cut = name.find("/app/src/")
        ran.add(name[len(root):] if name.startswith(root) else (name[cut + len("/app/"):] if cut >= 0 else name))
    return [f"listed but not run: {l}" for l in listed if l not in ran]


# ── the self-check: the judge can say no, both ways ──────────────────────────────────────────────────────────────

def _self_check() -> int:
    pine = ["app/src/components/chart/engine/**", "docs/pine/**"]
    whole = ["app/src/**"]
    gate, cov = ENGINE + "__tests__/memberPaneGate.test.js", ENGINE + "__tests__/suiteCoverage.test.js"
    inner = ENGINE + "binder.test.js"
    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)
        root = "/runner/work/repo/repo/"
        recs = [(gate, ["app/src/main.jsx", "app/src/pages", ENGINE + "pool.js"]),
                (cov, ["app/src/components/chart"]),
                (inner, [ENGINE + "pool.js", "docs/pine/coverage-map.json", "app/node_modules/x/index.js",
                         "reports/leg.json", ".git/HEAD"])]
        for i, (f, reads) in enumerate(recs):
            head = json.dumps({"schema": SCHEMA, "file": root + f, "kind": "worker"})
            body = [json.dumps(root + r) for r in reads] + [json.dumps("/tmp/elsewhere"), '"torn']
            (d / f"worker-{i}.jsonl").write_text("".join(line + "\n" for line in [head] + body))
        captured = load_captures(d)
    rails = derive(captured, {}, pine)
    expected = [gate, cov, inner]
    ok = []
    ok.append(("finds both controls and only them", sorted(rails) == sorted([gate, cov])))
    full = [_app_rel(gate), _app_rel(cov)]
    ok.append(("a complete list passes", judge(rails, set(captured), full, expected, whole, [gate, cov]) == []))
    ok.append(("a list without memberPaneGate fails",
               any("MISSING" in b and "memberPaneGate" in b for b in judge(rails, set(captured), full[1:], expected, whole, []))))
    ok.append(("a stale entry fails", any("no whole-app rail" in b for b in
                                          judge(rails, set(captured), full + [_app_rel(inner)], expected, whole, []))))
    ok.append(("an untriggered read fails", any("UNTRIGGERED" in b for b in
                                                judge(rails, set(captured), full, expected, ["app/src/pages/**"], []))))
    ok.append(("an uncaptured expected file fails", any("no read-capture record" in b for b in
                                                        judge(rails, set(captured) - {inner}, full, expected, whole, []))))
    ok.append(("the static scan reads code, not prose",
               _TEXT_IMPORT.findall(_code("// import X from '../../StockChart.jsx?raw'\nimport Y from '../a.jsx?raw'"))
               == ["../a.jsx"]))
    for name, good in ok:
        print(f"  {'ok ' if good else 'BAD'} {name}")
    if all(g for _, g in ok):
        print("ci_whole_app_rails self-check: OK")
        return 0
    print("ci_whole_app_rails self-check: FAILED")
    return 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--derive", action="store_true")
    ap.add_argument("--verify-list", action="store_true")
    ap.add_argument("--print-list", action="store_true", help="the listed files, space-separated (for `vitest run`)")
    ap.add_argument("--ran", type=pathlib.Path, help="a vitest --reporter=json output of the list's run")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--captures", type=pathlib.Path)
    ap.add_argument("--expected", type=pathlib.Path, help="`vitest list --filesOnly` over the roots, relative to --root")
    ap.add_argument("--root", default="app", help="what --expected is relative to (repo-relative)")
    ap.add_argument("--must-include", nargs="*", default=[], help="repo-relative controls that must be whole-app rails")
    ap.add_argument("--report", type=pathlib.Path, help="write {rail: [external reads]} as JSON here")
    ap.add_argument("--list", type=pathlib.Path, help=f"default: <repo>/{LIST.relative_to(ROOT).as_posix()}")
    ap.add_argument("--expected-list", action="store_true",
                    help="the captures cover the LISTED files only (the whole-app job's own run): expect exactly those")
    ap.add_argument("--repo", type=pathlib.Path, default=ROOT,
                    help="the checkout whose list, workflows and engine sources are judged (pine heavy runs this "
                         "tool from its CI-tools checkout against the ref under test)")
    a = ap.parse_args(argv)
    repo = a.repo.resolve()
    a.list = a.list or repo / LIST.relative_to(ROOT)

    if a.self_check:
        return _self_check()
    try:
        listed = read_list(a.list)
    except OSError as e:
        print(f"::error::cannot read the list {a.list}: {e}")
        return 2
    if a.print_list:
        print(" ".join(listed))
        return 0 if listed else 1
    if a.verify_list or a.ran:
        bad = verify_list(listed, repo)
        if a.ran:
            bad += ran_every_listed(a.ran, listed, repo / "app")
        for b in bad:
            print(f"::error::{b}")
        print(f"whole-app engine rails: {len(listed)} listed; {len(bad)} problem(s)")
        return 1 if bad else 0
    if not (a.check or a.derive) or not a.captures:
        ap.error("give --check or --derive with --captures, or --verify-list / --ran / --self-check")
    try:
        captured = load_captures(a.captures)
        static, globbers = static_text_reads(repo)
        pine = pr_paths(repo / PINE_HEAVY.relative_to(ROOT))
        whole = pr_paths(repo / WHOLE_APP_WF.relative_to(ROOT)) if a.check else []
        expected = []
        if a.expected_list:
            expected = ["app/" + l for l in listed]
            static = {t: v for t, v in static.items() if t in expected}
        elif a.expected:
            expected = [f"{a.root.rstrip('/')}/{_norm(l.strip())}" for l in a.expected.read_text(encoding="utf-8").splitlines() if l.strip()]
    except (OSError, ValueError, KeyError) as e:
        print(f"::error::cannot read the inputs: {e}")
        return 2
    rails = derive(captured, static, pine)
    if a.report:
        a.report.parent.mkdir(parents=True, exist_ok=True)
        a.report.write_text(json.dumps(rails, indent=1, sort_keys=True), encoding="utf-8")
    if a.derive:
        for t in sorted(rails):
            print(_app_rel(t))
        return 0
    eng_captured = {t for t in captured if t.startswith(ENGINE)}
    bad = judge(rails, eng_captured, listed, expected, whole + pine, a.must_include)
    bad += [f"{g} uses import.meta.glob, which this tool does not model (vite reads the matched files in the main "
            "process, where the read capture cannot see them): extend static_text_reads first" for g in globbers]
    for b in bad:
        print(f"::error::{b}")
    n_static = sum(1 for t in rails if t in static)
    print(f"whole-app engine rails: {len(eng_captured)} engine test files captured, {len(rails)} read outside pine "
          f"heavy's triggers ({n_static} through a ?raw/?url import), {len(listed)} listed; {len(bad)} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
