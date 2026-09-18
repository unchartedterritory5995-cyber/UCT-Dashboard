r"""OI-44 / R52 — the STATIC half: `async def` code that blocks the one shared event loop.

    python docs/discord-render/instruments/oi44_loop_blockers.py
    python docs/discord-render/instruments/oi44_loop_blockers.py --self-check

⛔⛔ WHY THIS IS ONLY HALF THE ANSWER, AND SAYS SO. R52 asks what coincides with each recorded
stall. That is a CORRELATION question and needs the durable record joined to a log slice
(`oi44_align.py`). This tool answers the other half — *what in this process is CAPABLE of
blocking the loop* — which narrows the candidate list a correlation has to choose between.
A name here is a SUSPECT, never a cause. `lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`.

⭐ THE ARCHITECTURE THAT MAKES THIS THE RIGHT QUESTION. The web pod is ONE uvicorn process:
one event loop, one anyio threadpool. FastAPI runs a `def` handler IN THE THREADPOOL and an
`async def` handler ON THE LOOP. So a slow `def` handler costs a threadpool worker (the 524
exhaustion class, real but different), while a blocking call inside an `async def` stops
EVERYTHING — every other request, every heartbeat, and the Discord ack whose budget is 3 s.

⚠️ AND THE THREADPOOL IS NOT INNOCENT EITHER, WHICH IS WHY `def` HANDLERS ARE REPORTED TOO,
SEPARATELY. Python holds the GIL: CPU-bound work on a threadpool thread still contends with the
loop's thread, so a 55 s CPU-heavy `def` handler CAN stall the loop without ever touching it.
⛔ Do not read "it is a `def`, so it is safe" out of this tool. It is reported as a WEAKER
suspect, not a cleared one — the difference is that blocking I/O in a thread is genuinely free
and CPU work in a thread is not, and this tool cannot tell those apart from source.

WHAT COUNTS AS BLOCKING, and each is a name the loop cannot yield across:
  * `sqlite3.connect` / `.execute` / `.commit`     — every DB on this pod is SQLite on a volume
  * `requests.*`, `httpx.get/post/...` (sync form) — a network round trip with no await
  * `time.sleep`                                   — the unambiguous one
  * `subprocess.run/check_output/call`             — a whole process, inline
  * `.read()/.write()` on a builtin `open()`       — volume I/O

⛔ A call is NOT reported when it is inside `run_in_threadpool(...)`, `asyncio.to_thread(...)`,
`loop.run_in_executor(...)` or a nested plain `def` — those are the correct escapes, and a tool
that flagged them would train people to ignore it.
"""
from __future__ import annotations

import argparse
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
API = ROOT / "api"

#: dotted-name suffixes that block. Matched on the ATTRIBUTE CHAIN, so `db.execute` and
#: `sqlite3.connect` both land, and a bare local `execute()` does not.
BLOCKING = {
    "sqlite3.connect": "sqlite", "time.sleep": "sleep",
    "requests.get": "net", "requests.post": "net", "requests.put": "net",
    "requests.delete": "net", "requests.request": "net",
    "httpx.get": "net", "httpx.post": "net", "httpx.put": "net", "httpx.request": "net",
    "subprocess.run": "subprocess", "subprocess.check_output": "subprocess",
    "subprocess.call": "subprocess", "subprocess.check_call": "subprocess",
}
#: The escapes. A blocking call lexically inside one of these is correct, not a finding.
ESCAPES = {"run_in_threadpool", "to_thread", "run_in_executor", "run_sync"}
ROUTE_DECOS = {"get", "post", "put", "delete", "patch", "head", "options", "websocket"}


def _dotted(node: ast.AST) -> str:
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def _is_route(fn: ast.AST) -> bool:
    for d in getattr(fn, "decorator_list", []):
        f = d.func if isinstance(d, ast.Call) else d
        if isinstance(f, ast.Attribute) and f.attr in ROUTE_DECOS:
            base = _dotted(f)
            if base.split(".")[0] in {"router", "app"} or ".router." in base:
                return True
    return False


class _Scan(ast.NodeVisitor):
    """Walk one async function, NOT descending into nested plain `def`s or escapes."""

    def __init__(self):
        self.hits: list[tuple[int, str, str]] = []

    def visit_FunctionDef(self, node):           # a nested `def` runs elsewhere
        return

    def visit_Lambda(self, node):
        return

    def visit_Call(self, node):
        name = _dotted(node.func)
        if name.split(".")[-1] in ESCAPES or name in ESCAPES:
            return                                # correct escape: do not descend
        for dotted, kind in BLOCKING.items():
            if name == dotted or name.endswith("." + dotted.split(".")[-1]) and \
                    dotted.split(".")[0] in name.split("."):
                self.hits.append((node.lineno, name, kind))
                break
        self.generic_visit(node)


def scan_file(path: pathlib.Path) -> list[dict]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except SyntaxError:
        return []
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        s = _Scan()
        for child in node.body:
            s.visit(child)
        if s.hits:
            out.append({"path": path, "func": node.name, "line": node.lineno,
                        "route": _is_route(node), "hits": s.hits})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    findings = []
    for p in sorted(API.rglob("*.py")):
        findings.extend(scan_file(p))
    routes = [f for f in findings if f["route"]]
    other = [f for f in findings if not f["route"]]
    print("OI-44 / R52 — blocking calls on the event loop (async def only)")
    print("!! A NAME HERE IS A SUSPECT, NOT A CAUSE. Correlate against the durable record")
    print("   (oi44_align.py) before naming anything as the cause of a measured stall.")
    for label, group in (("ROUTE HANDLERS (on the loop, per request)", routes),
                         ("OTHER async functions", other)):
        print(f"\n== {label}: {len(group)}")
        for f in group:
            rel = f["path"].relative_to(ROOT).as_posix()
            kinds = ",".join(sorted({k for _, _, k in f["hits"]}))
            print(f"  {rel}:{f['line']} async def {f['func']}()  [{kinds}]")
            for ln, name, kind in f["hits"][:4]:
                print(f"      line {ln}: {name}  ({kind})")
    print(f"\nTOTALS oi44_loop_blockers scanned={len(list(API.rglob('*.py')))} "
          f"async_fns_with_blocking={len(findings)} route_handlers={len(routes)}")
    return 0


def self_check() -> int:
    """⛔ Controls first: the scanner must SEE a planted blocker, must NOT see one that is
    correctly escaped, and must NOT see one inside a nested plain `def`."""
    import tempfile
    cases = [
        ("sees a blocking call on the loop",
         "import sqlite3\nasync def h():\n    sqlite3.connect('x')\n", 1),
        ("ignores one inside run_in_threadpool",
         "import sqlite3\nfrom x import run_in_threadpool\n"
         "async def h():\n    await run_in_threadpool(sqlite3.connect, 'x')\n", 0),
        ("ignores one inside asyncio.to_thread",
         "import sqlite3, asyncio\nasync def h():\n    await asyncio.to_thread(sqlite3.connect, 'x')\n", 0),
        ("ignores one in a nested plain def",
         "import sqlite3\nasync def h():\n    def inner():\n        sqlite3.connect('x')\n    return inner\n", 0),
        ("sees time.sleep",
         "import time\nasync def h():\n    time.sleep(3)\n", 1),
        ("a sync def is not scanned at all",
         "import sqlite3\ndef h():\n    sqlite3.connect('x')\n", 0),
    ]
    bad = 0
    with tempfile.TemporaryDirectory() as td:
        for name, src, want in cases:
            p = pathlib.Path(td) / "c.py"
            p.write_text(src, encoding="utf-8")
            got = sum(len(f["hits"]) for f in scan_file(p))
            ok = got == want
            bad += 0 if ok else 1
            print(f"  {'ok  ' if ok else 'FAIL'} {name}: want={want} got={got}")
    print(f"TOTALS oi44_loop_blockers --self-check {'PASS' if not bad else 'FAIL'} "
          f"declared={len(cases)} failed={bad}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
