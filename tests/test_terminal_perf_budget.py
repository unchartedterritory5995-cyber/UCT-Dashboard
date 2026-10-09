"""Rails for tools/terminal_perf_budget.py (lane w9-10, terminal load performance).

The report is advisory, so what it must get right is the READING: the shell root is found from
the graph (never typed), the closure is static-only, and the two flags fire on the shapes they
name and stay quiet otherwise. A manifest that cannot answer is UNEVALUABLE, never a quiet pass.
"""
from __future__ import annotations

import json
from pathlib import Path

from tools import terminal_perf_budget as tb


def _dist(tmp_path: Path, files: dict[str, int], manifest: dict) -> Path:
    d = tmp_path / "dist"
    (d / ".vite").mkdir(parents=True)
    (d / "assets").mkdir()
    for name, size in files.items():
        (d / name).write_bytes(b"x" * size)
    (d / ".vite" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return d


FILES = {
    "assets/index.js": 1000, "assets/vendor-react.js": 300, "assets/shell.js": 200,
    "assets/parse.js": 40, "assets/panel.js": 7000, "assets/vendor-charts.js": 900,
}


def _manifest(shell_imports=("_parse.js",)):
    return {
        "index.html": {"file": "assets/index.js", "imports": ["_vendor-react.js"],
                       "dynamicImports": ["_shell.js", "src/Other.jsx"]},
        "_vendor-react.js": {"file": "assets/vendor-react.js"},
        "_shell.js": {"file": "assets/shell.js", "name": "TerminalShell", "isDynamicEntry": True,
                      "imports": ["index.html", *shell_imports], "dynamicImports": ["src/Panel.jsx"]},
        "_parse.js": {"file": "assets/parse.js"},
        "src/Panel.jsx": {"file": "assets/panel.js", "isDynamicEntry": True, "imports": ["_shell.js"]},
        "_vendor-charts.js": {"file": "assets/vendor-charts.js"},
        "src/Other.jsx": {"file": "assets/panel.js"},
    }


def test_the_report_is_entry_plus_the_shells_static_closure_and_no_lazy_panel(tmp_path):
    r = tb.report(_dist(tmp_path, FILES, _manifest()))
    assert r["shell"] == "_shell.js"
    assert r["entry_bytes"] == 1300
    assert r["beyond_entry_bytes"] == 240           # shell 200 + parse 40, never the panel (7000)
    assert r["first_open_bytes"] == 1540
    assert r["flags"] == {"lazy_defeated": [], "heavy_vendor": []}


def test_a_panel_pulled_statically_and_a_heavy_vendor_are_flagged(tmp_path):
    m = _manifest(shell_imports=("_parse.js", "src/Panel.jsx", "_vendor-charts.js"))
    r = tb.report(_dist(tmp_path, FILES, m))
    assert r["flags"]["lazy_defeated"] == ["src/Panel.jsx"]
    assert r["flags"]["heavy_vendor"] == ["assets/vendor-charts.js"]
    assert r["first_open_bytes"] == 1540 + 7000 + 900


def test_no_shell_chunk_is_unevaluable_never_a_pass(tmp_path, capsys):
    m = _manifest()
    m["_shell.js"]["name"] = "SomethingElse"
    d = _dist(tmp_path, FILES, m)
    assert tb.main(["--dist", str(d)]) == 3
    assert "UNEVALUABLE" in capsys.readouterr().out


def test_main_prints_the_reading_and_exits_zero_even_with_flags(tmp_path, capsys):
    m = _manifest(shell_imports=("_parse.js", "src/Panel.jsx"))
    d = _dist(tmp_path, FILES, m)
    out_json = tmp_path / "r.json"
    assert tb.main(["--dist", str(d), "--json", str(out_json)]) == 0
    out = capsys.readouterr().out
    assert "terminal_first_open: 8,540 B" in out
    assert "ADVISORY lazy defeated: src/Panel.jsx" in out
    assert json.loads(out_json.read_text())["flags"]["lazy_defeated"] == ["src/Panel.jsx"]
