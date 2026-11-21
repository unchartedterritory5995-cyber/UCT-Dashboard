"""Rails for .github/workflows/derived-inventories.yml (2026-11-20).

Four rails re-derive a checked-in inventory or a declared set from the WHOLE api/ tree, and each sat red on master
for days to months because no lane ran it on the PR that changed what it reads (they read modules they never
import, so no path-aware lane selects them). The workflow runs them on every PR touching api/. What must stay true:
  * it is a PR-only, advisory (`promotion-gate: no`), read-only workflow;
  * its pytest step names each of the four, and itself;
  * its trigger covers what they read: api/**, each builder tool, each test file, the workflow;
  * one file that fails to import cannot hide the others (--continue-on-collection-errors).
Standard library + PyYAML.
"""
from __future__ import annotations

import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "derived-inventories.yml"
RAILS = ("tests/test_alert_taxonomy_indicator_condition_schema.py", "tests/test_entitlements_manifest.py",
         "tests/test_bars_ordinal_census.py", "tests/test_canonical_address_book.py")
#: each rail's builder (the tool a red tells you to re-run); the trigger must cover it
BUILDERS = ("tools/build_entitlements_manifest.py", "tools/bars_ordinal_census.py",
            "tools/build_canonical_address_book.py")


def _doc() -> dict:
    return yaml.safe_load(WF.read_text(encoding="utf-8"))


def _on(doc: dict) -> dict:
    return doc.get("on", doc.get(True))


def _rx(glob: str):
    """A GitHub `paths` pattern as a regex: `**` crosses `/`, `*` does not."""
    out = "".join(".*" if part == "**" else re.escape(part).replace(r"\*", "[^/]*")
                  for part in re.split(r"(\*\*)", glob))
    return re.compile(out + r"\Z")


def _covered(path: str, doc: dict) -> bool:
    return any(_rx(p).match(path) for p in _on(doc)["pull_request"]["paths"])


def _commands(doc: dict) -> list[str]:
    runs = [str(s.get("run") or "") for j in doc["jobs"].values() for s in j.get("steps") or []]
    return [r for r in runs if "-m pytest" in r]


def test_it_is_pr_only_advisory_and_read_only():
    text = WF.read_text(encoding="utf-8")
    assert text.splitlines()[0].startswith("# promotion-gate: no")
    doc = _doc()
    assert set(_on(doc)) == {"pull_request"}
    assert doc["permissions"] == {"contents": "read"}
    assert "secrets." not in text and "pull_request_target" not in text


def test_the_pytest_step_names_every_rail_and_cannot_stop_at_one_import_error():
    cmds = _commands(_doc())
    assert len(cmds) == 1, cmds
    for f in RAILS + ("tests/test_ci_derived_inventories.py",):
        assert f in cmds[0], f"the lane does not run {f}"
        assert (ROOT / f).is_file(), f"the lane names a file that does not exist: {f}"
    assert "--continue-on-collection-errors" in cmds[0]


def test_the_trigger_covers_what_the_rails_read():
    doc = _doc()
    for p in ("api/services/bars_sqlite.py", "api/routers/short_data.py",
              "api/services/alert_taxonomy/dark_report.py", ".github/workflows/derived-inventories.yml",
              *RAILS, *BUILDERS):
        assert _covered(p, doc), f"a PR changing {p} does not run the derived inventories"


def test_CONTROL_the_trigger_reading_can_say_no():
    doc = _doc()
    assert not _covered("app/src/pages/Login.jsx", doc)          # app/src is the app-src lane's, not this one's
    doc["on"] = {"pull_request": {"paths": ["api/services/*.py"]}}
    assert not _covered("api/routers/short_data.py", doc)        # `*` does not cross a directory
    assert _covered("api/services/bars_sqlite.py", doc)
