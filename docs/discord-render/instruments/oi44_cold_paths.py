r"""R63(a) — COLD PATHS: every first-use cost that can land on a request.

    python docs/discord-render/instruments/oi44_cold_paths.py            # scan + write the manifest
    python docs/discord-render/instruments/oi44_cold_paths.py --measure  # ...and time each cold import
    python docs/discord-render/instruments/oi44_cold_paths.py --self-check

⚰️ THE INCIDENT THIS EXISTS FOR, measured 2026-09-17. `/flow`'s dispatch gained one line —
`symbols.flow_source(tkr)` — which lazily imports `api.massive_processor` and loads the ETF
universe. Cold: 125.9 ms locally. On the live pod, the FIRST `/flow` after that deploy:

    18:35:21  drender ack cmd=flow hop=entry_to_ack ms=65462.6 itype=2   -> "The application did not respond"
    18:36:39  drender ack cmd=flow hop=entry_to_ack ms=1.4     itype=2

Sixty-five seconds, then 1.4 ms. **A cold first use, on the event loop, in front of a 3,000 ms
budget.** That is C-02's shape, and the boot-window stalls the durable record keeps catching
(uptime 58 s / 104 s / 117 s) fit it too.

⭐⭐ WHY THIS SCANS EVERY LAZY IMPORT AND NOT ONLY THE "ASYNC-REACHABLE" ONES. R63(a) asks for
imports reachable from an async handler or the Discord dispatch. Computing that honestly needs a
call graph, and a call graph that is wrong in the *permissive* direction produces a manifest with
holes — which is exactly the failure mode the preload barrier exists to remove. So the scope is
widened instead of guessed: **any lazy import in `api/**` can land on some request**, the
manifest names all of them, and R63(c) preloads the lot at boot. A wider manifest costs boot
seconds; a narrower one costs a member their ack.

⛔ A LAZY IMPORT IS NOT A DEFECT. It is usually a deliberate cycle-break or a cost deferral, and
this tool does not ask anyone to delete one. It asks that the cost be paid at BOOT, behind a
readiness barrier, instead of on whichever request happens to be first.

⛔ AND THE COST IS MEASURED, NEVER ESTIMATED (`--measure`). Each module is imported in a FRESH
interpreter subprocess and timed. Estimating from file size or import count is how a list gets
sorted by something other than what it costs.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
API = ROOT / "api"
MANIFEST = ROOT / "docs" / "discord-render" / "evidence" / "cold-paths" / "preload-manifest.json"

#: Loads that cost real time on first use and are not imports.
LOADERS = {
    "json.load": "json", "json.loads": "json",
    "sqlite3.connect": "sqlite",
    "pandas.read_csv": "pandas", "pandas.read_parquet": "pandas", "pandas.read_json": "pandas",
    "pickle.load": "pickle", "pickle.loads": "pickle",
    "yaml.safe_load": "yaml", "yaml.load": "yaml",
}
#: Synchronous HTTP inside async code — the third class R63(a) names.
SYNC_HTTP = {"requests.get", "requests.post", "requests.put", "requests.delete",
             "requests.request", "urllib.request.urlopen"}
ESCAPES = {"run_in_threadpool", "to_thread", "run_in_executor", "run_sync"}


def _dotted(node: ast.AST) -> str:
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def scan_file(path: pathlib.Path) -> dict:
    """Lazy imports, in-function loaders, and sync HTTP inside async, for one file."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except SyntaxError:
        return {"lazy_imports": [], "loaders": [], "sync_http": []}

    lazy, loaders, sync_http = [], [], []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        is_async = isinstance(fn, ast.AsyncFunctionDef)
        for node in ast.walk(fn):
            # a nested def is its own function; ast.walk sees it again, so no special case
            if isinstance(node, ast.Import):
                for a in node.names:
                    lazy.append({"module": a.name, "fn": fn.name, "line": node.lineno})
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.level == 0:
                    lazy.append({"module": node.module, "fn": fn.name, "line": node.lineno})
            elif isinstance(node, ast.Call):
                name = _dotted(node.func)
                if name.split(".")[-1] in ESCAPES:
                    continue
                for dotted, kind in LOADERS.items():
                    if name == dotted or name.endswith("." + dotted.split(".")[-1]) and \
                            dotted.split(".")[0] in name.split("."):
                        loaders.append({"call": name, "kind": kind, "fn": fn.name,
                                        "line": node.lineno})
                        break
                if is_async and name in SYNC_HTTP:
                    sync_http.append({"call": name, "fn": fn.name, "line": node.lineno})
    return {"lazy_imports": lazy, "loaders": loaders, "sync_http": sync_http}


def scan() -> dict:
    files, lazy, loaders, sync_http = 0, [], [], []
    for p in sorted(API.rglob("*.py")):
        files += 1
        r = scan_file(p)
        rel = p.relative_to(ROOT).as_posix()
        for x in r["lazy_imports"]:
            lazy.append({**x, "path": rel})
        for x in r["loaders"]:
            loaders.append({**x, "path": rel})
        for x in r["sync_http"]:
            sync_http.append({**x, "path": rel})
    return {"files": files, "lazy_imports": lazy, "loaders": loaders, "sync_http": sync_http}


def _importable(mod: str) -> bool:
    """⛔ Only OUR modules and third-party top-levels; a relative or private name is skipped
    rather than guessed at, and skipping is reported."""
    return bool(mod) and not mod.startswith(".")


#: ⛔⛔ EVERY SUBPROCESS PINS THE SHARED DATA ROOT BEFORE IT IMPORTS ANYTHING FROM `api.**`.
#: `/data` EXISTS as `C:\data` on this box, so a bare `import api.<x>` outside pytest resolves
#: every `os.environ.get("X", "/data/y")` to the owner's LIVE files. That is root cause 1 of the
#: 2026-09-08 sandbox incident, and it was re-committed on 2026-09-12 by a probe that set
#: `DATA_DIR` and believed itself sandboxed — `DATA_DIR` reaches almost none of them.
#: ⭐ The pins are DERIVED by `conftest.shared_data_root_census()` (AST over `api/**`), never
#: hand-picked, and applied BEFORE the import because these paths are captured at module import.
#:
#: ⚰️ MEASURED 2026-09-18: `import conftest` alone costs ~25 s and `shared_data_root_census()`
#: another ~9 s on this box under its ORDINARY concurrent load (several sessions + a local LLM
#: server routinely running here — this is not a spike, it is the box's baseline). The original
#: `_PRELUDE` paid that ~34 s cost FRESH IN EVERY CHILD, which scales to hours across 502
#: modules and is why the census's own 30 s self-check timeout started failing here — not a
#: regression in the census, a self-check timeout too tight for the environment it actually
#: runs in. `_census_env()` below pays the cost ONCE in the PARENT and hands each child the
#: already-derived pins as plain environment variables — the child never imports `conftest` at
#: all. This is safe because what the guard cares about is the ENVIRONMENT at import time, not
#: whether `conftest.py` itself was ever loaded in that process; a shared scratch sandbox
#: directory across all 502 measurements is fine too, because nothing here depends on
#: per-module filesystem isolation — only on none of them touching the owner's real `/data`.
_PRELUDE = r"""
import os, pathlib, sys, tempfile, time
sys.path.insert(0, %(root)r)
import conftest
_sandbox = tempfile.mkdtemp(prefix="coldscan-")
_, _pins, _ = conftest.shared_data_root_census()
for _env, _lit in _pins.items():
    os.environ[_env] = _lit.replace("/data", _sandbox)
os.environ.setdefault("UCT_TEST_SHARED_ROOT_GUARD", "enforce")
"""


def _census_env(root: "pathlib.Path | str") -> dict:
    """Derive the sandbox env pins ONCE and return a full environment dict a child subprocess
    can be launched with directly — no `conftest` import, no re-derivation, in the child.

    ⛔ Recomputes exactly what `_PRELUDE` computed per-child: same `conftest.shared_data_root_
    census()` call, same `/data` -> sandbox substitution, same `UCT_TEST_SHARED_ROOT_GUARD`
    default. This function is the ONLY place that logic now lives for the fast path; `_PRELUDE`
    stays as the reference/self-check form (a real subprocess doing it the slow, obviously-
    correct way) so the two can be compared rather than only ever trusting the fast one."""
    root = str(root)
    if root not in sys.path:
        sys.path.insert(0, root)
    import conftest
    sandbox = tempfile.mkdtemp(prefix="coldscan-")
    _, pins, _ = conftest.shared_data_root_census()
    env = dict(os.environ)
    for env_name, literal in pins.items():
        env[env_name] = literal.replace("/data", sandbox)
    env.setdefault("UCT_TEST_SHARED_ROOT_GUARD", "enforce")
    return env


def measure(modules: list[str], *, timeout: float = 120.0, fast: bool = True) -> list[dict]:
    """⛔ COLD COST, IN A FRESH INTERPRETER, ONE MODULE PER PROCESS. Timing an import inside
    THIS process measures nothing after the first one — everything else is already in
    `sys.modules`, and the second reading would be ~0 and look like good news.

    ⛔⛔ And every child pins the shared data root FIRST: importing `api.**` standalone on this
    box otherwise writes to the owner's live `C:\\data`. `fast=True` (default) derives those
    pins ONCE in this process and passes them to each child as plain env vars (`_census_env`) —
    ~34 s saved per module on this box. `fast=False` uses the original `_PRELUDE`, re-deriving
    in every child; kept for the self-check's non-vacuity control, which wants the two
    independent code paths to agree, not just the fast one asserting itself."""
    out = []
    if fast:
        child_env = _census_env(ROOT)
        code_prefix = "import time\n"
    else:
        child_env = None
        code_prefix = _PRELUDE % {"root": str(ROOT)}
    for mod in modules:
        code = (code_prefix +
                f"t=time.perf_counter()\n"
                f"import {mod}\n"
                f"print(round((time.perf_counter()-t)*1000,1))\n")
        try:
            p = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True,
                               text=True, timeout=timeout, errors="replace", env=child_env)
            ms = float(p.stdout.strip().splitlines()[-1]) if p.returncode == 0 else None
            err = None if p.returncode == 0 else (p.stderr.strip().splitlines() or ["?"])[-1][:120]
        except (subprocess.TimeoutExpired, ValueError, IndexError) as e:
            ms, err = None, type(e).__name__
        out.append({"module": mod, "cold_ms": ms, "error": err})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--measure", action="store_true", help="time each module's cold import")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--top", type=int, default=25)
    a = ap.parse_args()
    if a.self_check:
        return self_check()

    r = scan()
    mods = sorted({x["module"] for x in r["lazy_imports"] if _importable(x["module"])})
    print("R63(a) — cold paths that can land on a request")
    print("!! A LAZY IMPORT IS NOT A DEFECT. The ask is that its cost be paid at BOOT, behind a")
    print("   readiness barrier, instead of on whichever request happens to be first.")
    print(f"\nscanned {r['files']} file(s) under api/")
    print(f"  lazy imports (in-function): {len(r['lazy_imports'])} site(s), "
          f"{len(mods)} distinct module(s)")
    print(f"  in-function loaders:        {len(r['loaders'])}")
    print(f"  sync HTTP inside async:     {len(r['sync_http'])}")

    if r["sync_http"]:
        print("\n== SYNC HTTP INSIDE ASYNC (blocks the loop for a whole round trip)")
        for x in r["sync_http"][:20]:
            print(f"   {x['path']}:{x['line']} {x['fn']}() -> {x['call']}")

    rows = []
    if a.measure:
        print(f"\n== COLD IMPORT COST, measured in a fresh interpreter per module "
              f"({len(mods)} modules)")
        rows = measure(mods)
        ok = [x for x in rows if x["cold_ms"] is not None]
        ok.sort(key=lambda x: -x["cold_ms"])
        for x in ok[:a.top]:
            print(f"   {x['cold_ms']:9.1f} ms  {x['module']}")
        bad = [x for x in rows if x["cold_ms"] is None]
        if bad:
            print(f"   !! {len(bad)} module(s) could not be imported standalone "
                  f"(reported, never silently dropped):")
            for x in bad[:8]:
                print(f"      {x['module']}: {x['error']}")
        total = sum(x["cold_ms"] for x in ok)
        print(f"   TOTAL measured cold cost: {total:.0f} ms across {len(ok)} module(s)")

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps({
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "files_scanned": r["files"],
        "modules": mods,
        "measured": rows,
        "loaders": r["loaders"],
        "sync_http": r["sync_http"],
    }, indent=2) + "\n", encoding="utf-8")
    print(f"\nmanifest -> {MANIFEST.relative_to(ROOT).as_posix()}")
    print(f"TOTALS oi44_cold_paths files={r['files']} lazy_sites={len(r['lazy_imports'])} "
          f"modules={len(mods)} loaders={len(r['loaders'])} sync_http={len(r['sync_http'])}")
    return 0


def self_check() -> int:
    """⛔ One planted case per class R63(a) names, plus the escapes and a non-vacuity control."""
    import tempfile
    cases = [
        ("a lazy `import x` inside a function",
         "def f():\n    import mypkg.mod\n", "lazy_imports", 1),
        ("a lazy `from x import y` inside a function",
         "def f():\n    from mypkg.mod import thing\n", "lazy_imports", 1),
        ("a module-level import is NOT a lazy import",
         "import mypkg.mod\ndef f():\n    pass\n", "lazy_imports", 0),
        ("an in-function json load",
         "import json\ndef f():\n    json.load(open('x'))\n", "loaders", 1),
        ("an in-function sqlite open",
         "import sqlite3\ndef f():\n    sqlite3.connect('x')\n", "loaders", 1),
        ("sync HTTP inside async IS flagged",
         "import requests\nasync def f():\n    requests.get('u')\n", "sync_http", 1),
        ("sync HTTP inside a plain def is NOT in the async class",
         "import requests\ndef f():\n    requests.get('u')\n", "sync_http", 0),
        ("a loader behind run_in_threadpool is not a finding",
         "import json\nfrom x import run_in_threadpool\n"
         "async def f():\n    await run_in_threadpool(json.load, 'x')\n", "loaders", 0),
        ("a relative import is skipped, not guessed",
         "def f():\n    from . import sib\n", "lazy_imports", 0),
    ]
    bad = 0
    with tempfile.TemporaryDirectory() as td:
        for name, src, key, want in cases:
            p = pathlib.Path(td) / "c.py"
            p.write_text(src, encoding="utf-8")
            got = len(scan_file(p)[key])
            ok = got == want
            bad += 0 if ok else 1
            print(f"  {'ok  ' if ok else 'FAIL'} {name}: want={want} got={got}")

    # ⛔ NON-VACUITY FOR THE MEASURER: it must return a real number for a real module, and
    # None (never 0.0) for one that cannot be imported — 0 ms would sort as "free".
    # ⛔ The control module must be one the PRELUDE has not already imported, or it reads 0.0 ms
    # and the check passes while measuring nothing. `json` was the first choice and was exactly
    # that mistake: the prelude imports conftest, which pulls json in, so it timed an import that
    # had already happened.
    #
    # ⚰️ MEASURED 2026-09-18: `import conftest` + `shared_data_root_census()` costs ~34 s on
    # this box's ORDINARY load (several concurrent sessions + a local LLM server — not a spike).
    # A 30 s timeout on the SLOW (`fast=False`) path is therefore too tight for the environment
    # this actually runs in, not a defect in the census; widened to 90 s with margin. The FAST
    # path (`fast=True`, the default `measure()` now uses) pays that cost ONCE regardless of how
    # many modules are being timed, so it keeps a short timeout — a fast-path call that is
    # itself slow IS a real regression, not an environment fact.
    mods = ["xml.dom.minidom", "definitely_not_a_real_module_zzz"]
    m_fast = measure(mods, timeout=30, fast=True)
    m_slow = measure(mods, timeout=90, fast=False)

    def _shape_ok(m):
        return (m[0]["cold_ms"] is not None and m[0]["cold_ms"] > 0.0
                and m[1]["cold_ms"] is None)

    fast_ok, slow_ok = _shape_ok(m_fast), _shape_ok(m_slow)
    print(f"  {'ok  ' if fast_ok else 'FAIL'} fast path times a real module and reports an "
          f"unimportable one as None: {m_fast[0]['cold_ms']} / {m_fast[1]['cold_ms']}")
    print(f"  {'ok  ' if slow_ok else 'FAIL'} slow path (independent re-derivation) agrees: "
          f"{m_slow[0]['cold_ms']} / {m_slow[1]['cold_ms']}")
    bad += 0 if fast_ok else 1
    bad += 0 if slow_ok else 1

    print(f"TOTALS oi44_cold_paths --self-check {'PASS' if not bad else 'FAIL'} "
          f"declared={len(cases) + 2} failed={bad}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
