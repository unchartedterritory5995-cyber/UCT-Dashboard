"""UCT Agent program, agent-qa: no Agent server test reads the wall clock at IMPORT.

Requested by agent-lead (2026-11-01) after #579 was held: its quote tests captured NOW when the module was
imported, so a full suite run longer than the 60 s quote budget turned two passing tests red. Same cause as
"a default argument is bound at import" in CLAUDE.md: anything evaluated at import is evaluated ONCE.

The rail parses every `tests/test_uct_agent*.py` with `ast` (never a grep: prose and comments are not code)
and reports every wall-clock read that runs at import time:
  * a module-level or class-body statement (an assignment, a decorator argument, a bare expression);
  * a default argument value (`def f(now=time.time())`).
A read INSIDE a function body runs when the test runs, and is fine.

Wall-clock reads: time.time / time.time_ns / time.monotonic / time.perf_counter, datetime.now / utcnow /
today, date.today, under any import alias (`import time as t`, `from time import time`,
`from datetime import datetime as dt`).
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
_TIME_FUNCS = {"time", "time_ns", "monotonic", "monotonic_ns", "perf_counter", "perf_counter_ns"}
_DT_METHODS = {"now", "utcnow", "today"}


def _aliases(tree: ast.Module) -> tuple[set[str], set[str], set[str]]:
    """(names bound to the time module, bare clock functions, names bound to datetime/date classes)."""
    time_mods, clock_funcs, dt_classes = set(), set(), set()
    dt_mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == "time":
                    time_mods.add(a.asname or "time")
                if a.name == "datetime":
                    dt_mods.add(a.asname or "datetime")
        elif isinstance(node, ast.ImportFrom) and node.module == "time":
            for a in node.names:
                if a.name in _TIME_FUNCS:
                    clock_funcs.add(a.asname or a.name)
        elif isinstance(node, ast.ImportFrom) and node.module == "datetime":
            for a in node.names:
                if a.name in ("datetime", "date"):
                    dt_classes.add(a.asname or a.name)
    return time_mods, clock_funcs, dt_classes | {f"{m}.datetime" for m in dt_mods} | {f"{m}.date" for m in dt_mods}


def _dotted(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        inner = _dotted(node.value)
        return f"{inner}.{node.attr}" if inner else ""
    return ""


def _is_clock(call: ast.Call, aliases) -> bool:
    time_mods, clock_funcs, dt_classes = aliases
    f = call.func
    if isinstance(f, ast.Name):
        return f.id in clock_funcs
    if isinstance(f, ast.Attribute):
        owner = _dotted(f.value)
        if owner in time_mods and f.attr in _TIME_FUNCS:
            return True
        if owner in dt_classes and f.attr in _DT_METHODS:
            return True
    return False


def _calls(node: ast.AST, aliases) -> list[ast.Call]:
    return [n for n in ast.walk(node) if isinstance(n, ast.Call) and _is_clock(n, aliases)]


def clock_at_import(source: str, filename: str = "<src>") -> list[str]:
    """`file:line  <call>` for every wall-clock read that runs when the module is imported."""
    tree = ast.parse(source, filename)
    aliases = _aliases(tree)
    hits: list[ast.Call] = []

    def scope(body):                       # statements executed at import: module or class body
        for st in body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for d in st.decorator_list:
                    hits.extend(_calls(d, aliases))
                for dflt in st.args.defaults + [d for d in st.args.kw_defaults if d is not None]:
                    hits.extend(_calls(dflt, aliases))
            elif isinstance(st, ast.ClassDef):
                for d in st.decorator_list:
                    hits.extend(_calls(d, aliases))
                scope(st.body)
            elif isinstance(st, (ast.If, ast.With, ast.Try)):
                for part in ("body", "orelse", "finalbody"):
                    scope(getattr(st, part, []) or [])
                for h in getattr(st, "handlers", []) or []:
                    scope(h.body)
                if isinstance(st, ast.If):
                    hits.extend(_calls(st.test, aliases))
            else:
                hits.extend(_calls(st, aliases))

    scope(tree.body)
    return sorted({f"{filename}:{c.lineno}  {ast.unparse(c)}" for c in hits})


#: Known offenders on agent/int, each with its finding and owner. STRICT both ways: a new offender fails the rail,
#: and so does an entry here that no longer matches (fixed lines must be removed, not left as a silent excuse).
KNOWN: dict[str, str] = {
    "tests/test_uct_agent_data_quotes.py:22  time.time()":
        "F-6 (agent-md): NOW captured at import since #569; tests compare vendor stamps against it under the 60 s "
        "quote budget, so they flip once the suite has run for ~20 s before them",
}


def _agent_test_files() -> list[Path]:
    return sorted((REPO / "tests").glob("test_uct_agent*.py"))


def test_no_agent_test_reads_the_wall_clock_at_import():
    files = _agent_test_files()
    assert len(files) > 5, "the glob found almost no Agent test files: the rail would pass over nothing"
    assert any(f.name == "test_uct_agent_qa_clock.py" for f in files)        # non-vacuity: it sees itself
    found = []
    for f in files:
        found += clock_at_import(f.read_text(encoding="utf-8"), f.relative_to(REPO).as_posix())
    new = [h for h in found if h not in KNOWN]
    assert not new, ("these read the wall clock at IMPORT, so a long suite run ages them; read the clock inside "
                     "the test (or a fixture) instead:\n  " + "\n  ".join(new))
    gone = [k for k in KNOWN if k not in found]
    assert not gone, f"fixed — remove these KNOWN entries: {gone}"


@pytest.mark.parametrize("src", [
    "import time\nNOW = time.time()\n",
    "import time as t\nNOW = t.monotonic()\n",
    "from time import time\nNOW = time()\n",
    "from datetime import datetime\nNOW = datetime.now()\n",
    "from datetime import datetime as dt, timezone\nNOW = dt.now(timezone.utc).timestamp()\n",
    "import datetime\nTODAY = datetime.date.today()\n",
    "import time\ndef test_x(now=time.time()):\n    pass\n",
    "import time\nclass T:\n    NOW = time.time()\n",
    "import time\nif True:\n    NOW = time.time()\n",
    "import time\nROWS = [{'t': time.time() - 5}]\n",
])
def test_the_rail_SEES_an_import_time_clock_read(src):
    assert clock_at_import(src), src


@pytest.mark.parametrize("src", [
    "import time\ndef test_x():\n    now = time.time()\n",
    "import time\nclass T:\n    def test_x(self):\n        return time.time()\n",
    "import time\nNOTE = 'time.time() at import is a trap'  # time.time()\n",
    "import datetime as dt\nFIXED = dt.datetime(2026, 10, 30, 15, 0)\n",
    "import time\ndef f(clock=time.time):\n    return clock()\n",
])
def test_the_rail_IGNORES_reads_that_run_inside_a_test(src):
    assert clock_at_import(src) == [], src
