"""⛔⛔ TradingView's compiled script never enters this public repo (coordinator ruling 2026-11-23).

A capture's hidden `ILScript` input is TradingView's encrypted compiled form of the script. Committed captures carry it
redacted and re-sealed (`tools/vendor_harness/redact_capture.mjs`; `schema.mjs::verifyRedactions`, railed in
`vendorHarness/redactions.test.js`). Here: the repo-bound writer (evidence_engine PROMOTE) refuses a capture that carries
it in the clear, and reads its marker from schema.mjs rather than restating it.
"""
import json
import pathlib
import re
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "vendor_harness"))
import evidence_engine as ee  # noqa: E402

SCHEMA = (REPO / "tools" / "vendor_harness" / "schema.mjs").read_text(encoding="utf-8")


def _cap(value):
    return {"study": {"inputs": [{"id": "text", "name": "ILScript", "isHidden": True, "value": value},
                                 {"id": "in_0", "name": "Length", "value": 14}]}}


def test_the_marker_is_schema_mjs_own():
    assert ee._REDACTED_MARK == re.search(r"export const REDACTED_COMPILED_SCRIPT = '([^']+)'", SCHEMA).group(1)


@pytest.mark.parametrize("value,clear", [
    ("bmI9Ks46_AAAA==", True),           # the compiled script in the clear
    (None, False), ("", False),          # absent / empty: nothing to protect
])
def test_compiled_script_in_clear(value, clear):
    assert ee.compiled_script_in_clear(_cap(value)) is clear
    assert ee.compiled_script_in_clear(_cap(ee._REDACTED_MARK)) is False


def test_a_compiled_script_in_defval_is_also_clear():
    cap = {"study": {"inputs": [{"name": "ILScript", "value": ee._REDACTED_MARK, "defval": "bmI9Ks46_AAAA=="}]}}
    assert ee.compiled_script_in_clear(cap) is True


def test_promote_checks_before_it_copies():
    """⛔ the refusal sits on the ONE copy into tests/fixtures/vendor/harness, before it (a check after the copy would
    leave the file in the tree)."""
    src = (REPO / "tools" / "vendor_harness" / "evidence_engine.py").read_text(encoding="utf-8")
    body = src[src.index('if i["action"] == "PROMOTE":'):]
    body = body[:body.index("promoted.append")]
    assert body.index("compiled_script_in_clear(") < body.index("shutil.copyfile(")
    assert "raise PromoteRefused" in body


def test_promote_refuses_a_clear_capture(tmp_path, monkeypatch):
    """End to end on the promote loop: a PROMOTE item whose capture carries the compiled script raises, and nothing is
    copied into the fixtures dir."""
    cap = tmp_path / "x.json"
    cap.write_text(json.dumps(_cap("bmI9Ks46_AAAA==")), encoding="utf-8")
    fixtures = tmp_path / "fixtures"
    src = (REPO / "tools" / "vendor_harness" / "evidence_engine.py").read_text(encoding="utf-8")
    block = src[src.index('        if i["action"] == "PROMOTE":'):]
    block = block[:block.index("            promoted.append")]
    ns = {"pathlib": pathlib, "json": json, "shutil": ee.shutil, "REPO": REPO, "compiled_script_in_clear": ee.compiled_script_in_clear,
          "PromoteRefused": ee.PromoteRefused, "fixtures_dir": fixtures, "refused": []}
    code = "for i in [{'id': 'x', 'action': 'PROMOTE', 'file': %r}]:\n" % str(cap) + block
    with pytest.raises(ee.PromoteRefused, match="compiled script"):
        exec(compile(code, "promote-block", "exec"), ns)
    assert not (fixtures / "x.json").exists()
