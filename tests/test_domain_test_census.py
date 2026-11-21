"""The rail on tools/domain_test_census.py (2026-11-20): every tests/**/test_*.py lands in exactly one lane, in a
domain whose lane is queued with its reason, or on EXEMPT with its reason. A file no rule maps is red.

Measured when this landed: 3,453 test files, 643 homed by a lane, the rest in 18 domains still queued (PENDING).
This rail does not make a queued domain run; it makes the queue a list a reviewer reads instead of a gap nobody
sees, and it keeps three promises while the domains go LIVE one PR at a time:
  * every file maps to ONE domain, derived from its own imports (`domain_of`); a file that does not parse maps to
    none and is named;
  * every domain is LIVE (a workflow runs its shards) or PENDING (with a reason), never neither, never both;
  * a LIVE domain's lane runs exactly the files no other lane runs (never one twice), split 1..N.
Standard library + PyYAML; it reads the workflows and imports the tools, never `api.*`.
"""
from __future__ import annotations

import pathlib
import sys

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import domain_test_census as T  # noqa: E402


@pytest.fixture(scope="module")
def census():
    return T.census(ROOT)


def test_every_test_file_maps_to_one_domain_and_the_census_is_not_vacuous(census):
    assert len(census) >= 3000, f"only {len(census)} test files: the walk is broken, not the suite"
    unmapped = sorted(f for f, r in census.items() if r["domain"] is None)
    assert not unmapped, f"test files no domain rule maps (they do not parse): {unmapped}"
    assert sum(1 for r in census.values() if r["homes"]) >= 500, "almost nothing is homed: the lane reading is broken"


def test_the_census_reports_no_problem(census):
    found = T.problems(ROOT, census)
    assert not found, "\n".join(found)


def test_every_live_domain_lane_runs_its_shards_1_to_n_and_nothing_twice(census):
    for domain, wf in T.LIVE.items():
        doc = yaml.safe_load((ROOT / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        text = (ROOT / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        assert f"domain_test_census.py" in text and domain in text, f"{wf} does not run the {domain} census shards"
        legs = [leg for job in doc["jobs"].values()
                for leg in ((job.get("strategy") or {}).get("matrix") or {}).get("include") or []
                if leg.get("domain") == domain]
        specs = sorted(tuple(int(x) for x in leg["shard"].split("/")) for leg in legs)
        assert specs and specs == [(k, specs[0][1]) for k in range(1, specs[0][1] + 1)], (wf, specs)
        runs = T.to_run(census, domain)
        assert not [f for f in runs if census[f]["homes"]], f"{domain} would run a file another lane runs"


def test_the_queue_names_every_domain_that_has_no_lane():
    queued = set(T.PENDING) | set(T.LIVE) | {"pine"}
    assert queued == set(T.ALL_DOMAINS), f"domains on no list: {sorted(set(T.ALL_DOMAINS) - queued)}"


def test_CONTROL_the_mapping_reads_imports_and_names_an_unparsable_file(tmp_path):
    cases = {
        "from api.services.journal_two import notes\n": "notebook-journal",
        "from api.services import ast_interpret\nfrom api.services.journal_two import x\n": "pine",  # order wins
        "def f():\n    from api.services.screener import scan_store\n": "screener-scan",
        "from tools import ci_offline\n": "tools",
        "from api.services import cache\n": "api-other",
        "import json\nX = 'from api.services.journal_two import notes'\n": "repo-hygiene",   # a string is not code
        "def broken(:\n": None,
    }
    for i, (src, want) in enumerate(cases.items()):
        p = tmp_path / f"test_probe_{i}.py"
        p.write_text(src, encoding="utf-8")
        assert T.domain_of(T.imports(p)) == want, src


def test_CONTROL_a_domain_on_neither_list_is_named(census, monkeypatch):
    monkeypatch.delitem(T.PENDING, "desk")
    assert any("desk" in p for p in T.problems(ROOT, census))
    monkeypatch.setitem(T.PENDING, "desk", "back")
    monkeypatch.setitem(T.EXEMPT, "tests/test_no_such_file_anywhere.py", "a reason")
    assert any("stale exemption" in p for p in T.problems(ROOT, census))


def test_CONTROL_shards_partition_a_domain():
    files = [f"tests/test_{i:03d}.py" for i in range(37)]
    shards = T.plan(files, 3, {})
    assert sorted(f for s in shards for f in s) == sorted(files) and all(shards)
