"""Rails for tools/notebook_perf_budgets.py (wave 7, lane I2).

The byte budget is only worth something if it (a) prices the chunks the route really
reaches, derived from the manifest's STATIC import graph rather than a hand-typed list;
(b) leaves dynamic imports out, because they load on demand; (c) fails CLOSED when the
graph cannot answer, e.g. a renamed route root; and (d) names the offending numbers when
it breaches. Each of those is pinned here against a synthetic manifest. The committed
budget file is checked for shape too, so the CI job cannot pass by reading an empty
budget.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools import notebook_perf_budgets as pb


def _dist(tmp_path: Path, files: dict[str, int], manifest: dict) -> Path:
    d = tmp_path / "dist"
    (d / ".vite").mkdir(parents=True)
    (d / "assets").mkdir()
    for name, size in files.items():
        (d / name).write_bytes(b"x" * size)
    (d / ".vite" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return d


FILES = {
    "assets/index.js": 1000, "assets/vendor-react.js": 300, "assets/route.js": 200,
    "assets/shared.js": 50, "assets/lazyview.js": 7000, "assets/route.css": 999,
    "assets/other.js": 4000,
}
MANIFEST = {
    "index.html": {"file": "assets/index.js", "imports": ["_vendor-react.js"],
                   "dynamicImports": ["src/Route.jsx", "src/Other.jsx"]},
    "_vendor-react.js": {"file": "assets/vendor-react.js"},
    "src/Route.jsx": {"file": "assets/route.js", "imports": ["_shared.js", "_vendor-react.js"],
                      "dynamicImports": ["src/LazyView.jsx"], "css": ["assets/route.css"]},
    "_shared.js": {"file": "assets/shared.js"},
    "src/LazyView.jsx": {"file": "assets/lazyview.js", "imports": ["_shared.js"]},
    "src/Other.jsx": {"file": "assets/other.js"},
    "assets/route.css": {"file": "assets/route.css"},
}


def _budgets(max_bytes: int, roots=("src/Route.jsx",)) -> dict:
    return {"bytes": {"route_first_open": {"roots": list(roots), "baseline": 1550, "max": max_bytes}}}


def test_the_closure_is_the_static_graph_entry_included_dynamic_and_siblings_excluded(tmp_path):
    d = _dist(tmp_path, FILES, MANIFEST)
    breaches, detail = pb.check_bytes(_budgets(10_000), d)
    assert breaches == []
    got = detail["route_first_open"]
    # entry 1000 + vendor-react 300 + route 200 + shared 50 -- never the lazy view (7000),
    # never the sibling route (4000), never CSS (999).
    assert got["bytes"] == 1550
    assert got["chunks"] == 4
    assert {f for f, _ in got["largest"]} == {"assets/index.js", "assets/vendor-react.js",
                                             "assets/route.js", "assets/shared.js"}


def test_a_breach_names_the_total_the_budget_and_the_overage(tmp_path):
    d = _dist(tmp_path, FILES, MANIFEST)
    breaches, _ = pb.check_bytes(_budgets(1500), d)
    assert breaches == ["bytes.route_first_open: 1,550 B > budget 1,500 B (+50 B over); largest chunks: "
                        "assets/index.js 1,000, assets/vendor-react.js 300, assets/route.js 200, "
                        "assets/shared.js 50"]


def test_a_route_root_the_manifest_does_not_know_fails_closed(tmp_path):
    d = _dist(tmp_path, FILES, MANIFEST)
    with pytest.raises(pb.Unevaluable, match="not in the manifest"):
        pb.check_bytes(_budgets(10_000, roots=("src/Renamed.jsx",)), d)


def test_a_missing_manifest_or_a_missing_chunk_fails_closed(tmp_path):
    with pytest.raises(pb.Unevaluable, match="no Vite manifest"):
        pb.check_bytes(_budgets(10_000), tmp_path / "nodist")
    d = _dist(tmp_path, {k: v for k, v in FILES.items() if k != "assets/shared.js"}, MANIFEST)
    with pytest.raises(pb.Unevaluable, match="stale or partial build"):
        pb.check_bytes(_budgets(10_000), d)


def test_main_exit_codes_and_the_json_it_writes(tmp_path, capsys):
    d = _dist(tmp_path, FILES, MANIFEST)
    good = tmp_path / "good.json"
    good.write_text(json.dumps(_budgets(10_000)), encoding="utf-8")
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(_budgets(100)), encoding="utf-8")
    out = tmp_path / "out.json"
    assert pb.main(["--budgets", str(good), "--dist", str(d), "--json", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["bytes"]["route_first_open"]["bytes"] == 1550
    assert pb.main(["--budgets", str(bad), "--dist", str(d)]) == 1
    assert "BREACH bytes.route_first_open: 1,550 B > budget 100 B" in capsys.readouterr().out
    assert pb.main(["--budgets", str(good), "--dist", str(tmp_path / "nodist")]) == 3
    assert pb.main(["--budgets", str(good)]) == 3  # nothing to check is not a pass


def _report(n, ops):
    return {"tiers": [{"n": n, "ops": {k: {"p95_ms": v} for k, v in ops.items()}}]}


def test_check_search_names_the_op_tier_and_both_numbers():
    spec = {"p95_ms_max": 100, "tier": 50000, "ops": ["a", "b"]}
    assert pb.check_search(_report(50000, {"a": 12.0, "b": 99.9}), spec) == []
    assert pb.check_search(_report(50000, {"a": 12.0, "b": 140.25}), spec) == [
        "'b' at 50,000 notes: p95 140.2 ms >= budget 100 ms"]


def test_check_search_counts_an_unmeasured_op_or_tier_as_a_breach_and_refuses_an_empty_budget():
    spec = {"p95_ms_max": 100, "tier": 50000, "ops": ["a", "missing"]}
    assert pb.check_search(_report(50000, {"a": 1.0}), spec) == [
        "'missing' at 50,000 notes: not measured by this run"]
    assert "was not run" in pb.check_search(_report(10000, {"a": 1.0}), spec)[0]
    with pytest.raises(pb.Unevaluable, match="names no ops"):
        pb.check_search(_report(50000, {"a": 1.0}), {"p95_ms_max": 100, "tier": 50000, "ops": []})


LATENCY_KEYS = ("search", "reads", "tasks", "search_ci", "reads_ci", "tasks_ci")


def test_the_committed_budget_file_is_complete_and_hand_edit_documented():
    budgets = json.loads(pb.DEFAULT_BUDGETS.read_text(encoding="utf-8"))
    assert "by hand" in budgets["_"].lower()
    nb = budgets["bytes"]["notebook_first_open"]
    assert nb["roots"], "no route roots: the byte budget would price nothing"
    assert int(nb["max"]) <= int(nb["baseline"] * 1.05) + 1, "max drifted above baseline + 5% without saying so"
    for key in LATENCY_KEYS:
        spec = budgets[key]
        assert spec["ops"] and float(spec["p95_ms_max"]) > 0 and int(spec["tier"]) > 0, key
    # the brief's number, not a softened one
    assert budgets["search"]["tier"] == 50000 and budgets["search"]["p95_ms_max"] == 100


def test_every_budgeted_op_is_an_op_the_benchmark_times():
    """A typo in an op name is a budget that can never pass (it reads as "not measured").
    The names are checked against the benchmark's own list, never retyped here."""
    from tools import notebook_scale_benchmark as bench
    budgets = json.loads(pb.DEFAULT_BUDGETS.read_text(encoding="utf-8"))
    named = {op for key in LATENCY_KEYS for op in budgets[key]["ops"] + budgets[key].get("informational", [])}
    assert named, "non-vacuity: the budget names no ops at all"
    assert named <= set(bench.TIMED_OPS), sorted(named - set(bench.TIMED_OPS))


def test_an_informational_op_is_printed_against_the_line_and_never_breaches():
    """Review M-8: an op a budget names under "informational" is measured and reported against
    the SAME line, and is never a breach. A name cannot be both enforced and informational."""
    spec = {"p95_ms_max": 100, "tier": 10000, "ops": ["a"], "informational": ["fuzzy"]}
    report = _report(10000, {"a": 12.0, "fuzzy": 131.5})
    assert pb.check_search(report, spec) == []
    assert pb.informational_notes(report, spec) == [
        "'fuzzy' at 10,000 notes: p95 131.5 ms, OVER the 100 ms line (informational at this tier, not enforced)"]
    # control: the same reading, enforced, IS a breach -- the line was not moved
    assert pb.check_search(report, {**spec, "ops": ["a", "fuzzy"], "informational": []}) == [
        "'fuzzy' at 10,000 notes: p95 131.5 ms >= budget 100 ms"]
    assert "not measured" in pb.informational_notes(_report(10000, {"a": 1.0}), spec)[0]
    with pytest.raises(pb.Unevaluable, match="both enforced and informational"):
        pb.check_search(report, {**spec, "ops": ["a", "fuzzy"]})


def test_a_reading_that_did_not_reproduce_is_a_note_and_one_that_did_is_a_breach(tmp_path, capsys):
    """Tooling review I-3, at the budget tool's own door (what the CI step runs): an op over its
    line whose `remeasure` came in under it passes with a note naming both numbers; one whose
    re-measure is over too breaches and names both; a report with no re-measure is judged on its
    one reading (the stricter direction, unchanged)."""
    budgets = tmp_path / "b.json"
    budgets.write_text(json.dumps({"s": {"tier": 10000, "p95_ms_max": 100, "ops": ["a"]}}), encoding="utf-8")
    bench = tmp_path / "bench.json"

    def run(st):
        bench.write_text(json.dumps({"tiers": [{"n": 10000, "ops": {"a": st}}]}), encoding="utf-8")
        code = pb.main(["--budgets", str(budgets), "--bench", str(bench), "--budget", "s"])
        return code, capsys.readouterr().out

    code, out = run({"p95_ms": 160.0, "remeasure": {"p95_ms": 13.6}})
    assert code == 0 and "VERDICT: PASS" in out, out
    assert "p95 160.0 ms, then 13.6 ms on an immediate re-measure -- did not reproduce" in out, out
    code, out = run({"p95_ms": 160.0, "remeasure": {"p95_ms": 151.0}})
    assert code == 1 and "BREACH [s] 'a' at 10,000 notes: p95 160.0 ms >= budget 100 ms; re-measured 151.0 ms" in out
    code, out = run({"p95_ms": 160.0})
    assert code == 1 and "p95 160.0 ms >= budget 100 ms" in out and "re-measured" not in out
    code, out = run({"p95_ms": 160.0, "remeasure": {"oops": 1}})      # unreadable: one reading
    assert code == 1, out


def test_the_ci_switcher_is_informational_at_10k_and_still_enforced_at_50k():
    """The committed shape of M-8: the untouched switcher's fuzzy op reads 90.5 ms p95 at 10k on
    this box (perf-budgets.md section 2) and would flap on a shared runner, so the CI twin only
    reports it. The line is not raised, and the local 50k gate still enforces the op."""
    budgets = json.loads(pb.DEFAULT_BUDGETS.read_text(encoding="utf-8"))
    op = "switcher_search (fuzzy, in order)"
    ci = budgets["search_ci"]
    assert ci.get("informational") == [op] and op not in ci["ops"]
    assert ci["p95_ms_max"] == 100 and budgets["search"]["p95_ms_max"] == 100
    assert op in budgets["search"]["ops"], "the 50k gate must still enforce the switcher"
    assert "M-8" in ci.get("informational_why", "")
