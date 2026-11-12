"""Boot timing (2026-11-11): every deploy is a gap on a volume-backed Railway service (measured ~40 s of 502
for members on 2026-11-12), and process start -> serving is the part we control. `_boot_mark` records it;
/api/health carries the summary. Observability only."""
import ast
import pathlib

import api.main as m


def test_summary_names_the_slowest_segments_and_the_time_to_serving(monkeypatch):
    monkeypatch.setattr(m, "_BOOT_MARKS", [("lifespan-start", 6.0), ("L4811", 7.0), ("jobs-start", 9.5), ("J7200", 17.0), ("ready", 21.0)])
    s = m._boot_summary()
    assert s["import_s"] == 6.0 and s["to_serving_s"] == 21.0
    assert s["slowest"][0] == {"from": "jobs-start", "s": 7.5}
    assert [x["from"] for x in s["slowest"]] == ["jobs-start", "J7200", "L4811", "lifespan-start"]


def test_before_any_mark_the_summary_is_empty_and_never_raises(monkeypatch):
    monkeypatch.setattr(m, "_BOOT_MARKS", [])
    assert m._boot_summary() == {}
    m._boot_log()


def test_the_marks_stay_in_the_lifespan_from_start_to_serving():
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    life = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    calls = sorted((c.lineno, c.args[0].value) for c in ast.walk(life) if isinstance(c, ast.Call) and getattr(c.func, "id", "") == "_boot_mark")
    names = [n for _, n in calls]
    assert names[0] == "lifespan-start" and names[-1] == "ready"
    assert "jobs-start" in names and len(names) >= 10
