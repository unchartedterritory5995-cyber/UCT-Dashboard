"""The website's half of the desktop bridge contract.

The desktop shell ships on its own release train, so a website change can never assume the shell
was updated with it. tests/fixtures/desktop_bridge.json is a copy of the shell's contract/bridge.json;
this file refuses a website that uses more than that contract, and a contract that drops a method a
released shell already answers.

Stdlib only: it reads source text and parses api/main.py with ast, and imports no part of the app.
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BRIDGE_JSON = REPO / "tests" / "fixtures" / "desktop_bridge.json"
BRIDGE_MODULE = REPO / "app" / "src" / "lib" / "desktopBridge.js"
APP_SRC = REPO / "app" / "src"
MAIN_PY = REPO / "api" / "main.py"

# Append-only. A shell in members' hands calls and answers these for as long as it is installed.
RELEASED_METHODS = frozenset({"getInfo", "onWindowState", "onBeforeQuit", "ackBeforeQuit"})
RELEASED_CAPABILITIES = frozenset({"window-state", "before-quit"})

# webPush.js only tests the global for presence (the shell delivers notifications through the page,
# so a site Web Push subscription does not apply). It reads no member of it, and predates this module.
PRESENCE_ONLY_READERS = frozenset({"app/src/utils/webPush.js"})

# What a deployed shell's health and update checks may read.
HEALTH_FIELDS = frozenset({"status", "uptime_seconds", "build_id"})

_SOURCE_SUFFIXES = {".js", ".jsx", ".ts", ".tsx"}
_FEATURE_CALL = re.compile(r"""hasDesktopFeature\(\s*['"]([^'"]+)['"]\s*\)""")
# The module reads the global through a local named `b` or getBridge(): both forms are scanned.
_MEMBER_ON_BRIDGE = re.compile(r"(?:\bb|\bgetBridge\(\))\.([A-Za-z_]\w*)")
_COMPUTED_ON_BRIDGE = re.compile(r"\bgetBridge\(\)\s*\[")
_GLOBAL_MEMBER_ACCESS = re.compile(r"uctDesktop\s*(?:\?\.|\.|\[)")
_FEATURE_TABLE = re.compile(r"const FEATURE_METHODS = \{(.*?)\n\}", re.S)
_FEATURE_ROW = re.compile(r"""['"]([^'"]+)['"]\s*:\s*\[([^\]]*)\]""")
_STRING = re.compile(r"""['"]([^'"]+)['"]""")


def load_contract() -> dict:
    return json.loads(BRIDGE_JSON.read_text(encoding="utf-8"))


def source_files(root: Path) -> list[Path]:
    return [
        p
        for p in root.rglob("*")
        if p.suffix in _SOURCE_SUFFIXES and ".test." not in p.name and "__tests__" not in p.parts
    ]


def missing_released(contract: dict) -> set[str]:
    """Released names the contract no longer carries."""
    return (RELEASED_METHODS - set(contract.get("methods", []))) | (
        RELEASED_CAPABILITIES - set(contract.get("capabilities", []))
    )


def unknown_feature_calls(text: str, contract: dict) -> set[str]:
    return set(_FEATURE_CALL.findall(text)) - set(contract["capabilities"])


def unknown_bridge_members(module_text: str, contract: dict) -> set[str]:
    allowed = set(contract["methods"]) | set(contract["properties"])
    unknown = set(_MEMBER_ON_BRIDGE.findall(module_text)) - allowed
    if _COMPUTED_ON_BRIDGE.search(module_text):
        unknown.add("getBridge()[...]: a computed member the scan cannot read")
    return unknown


def global_member_accesses(text: str) -> list[str]:
    return _GLOBAL_MEMBER_ACCESS.findall(text)


def feature_table_errors(module_text: str, contract: dict) -> set[str]:
    table = _FEATURE_TABLE.search(module_text)
    if not table:
        return {"FEATURE_METHODS table not found"}
    rows = _FEATURE_ROW.findall(table.group(1))
    if not rows:
        return {"FEATURE_METHODS has no rows"}
    errors: set[str] = set()
    for capability, methods in rows:
        if capability not in contract["capabilities"]:
            errors.add(capability)
        errors |= set(_STRING.findall(methods)) - set(contract["methods"])
    return errors


def health_response_keys(main_source: str) -> set[str]:
    tree = ast.parse(main_source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "health":
            for stmt in ast.walk(node):
                if isinstance(stmt, ast.Return) and isinstance(stmt.value, ast.Dict):
                    return {k.value for k in stmt.value.keys if isinstance(k, ast.Constant)}
    raise AssertionError("def health() returning a dict literal was not found in api/main.py")


def test_contract_still_carries_every_released_name():
    assert missing_released(load_contract()) == set()


def test_only_the_bridge_module_names_the_global():
    offenders = [
        str(p.relative_to(REPO))
        for p in source_files(APP_SRC)
        if p != BRIDGE_MODULE
        and p.relative_to(REPO).as_posix() not in PRESENCE_ONLY_READERS
        and "uctDesktop" in p.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_presence_only_readers_read_no_member_of_the_global():
    for relative in sorted(PRESENCE_ONLY_READERS):
        text = (REPO / relative).read_text(encoding="utf-8")
        assert "uctDesktop" in text, f"{relative} no longer needs this exemption"
        assert global_member_accesses(text) == [], f"{relative} must only test the global for presence"


def test_every_feature_asked_for_is_in_the_contract():
    contract = load_contract()
    unknown = {
        f"{p.relative_to(REPO)}: {name}"
        for p in source_files(APP_SRC)
        for name in unknown_feature_calls(p.read_text(encoding="utf-8"), contract)
    }
    assert unknown == set()


def test_bridge_module_touches_only_contract_members():
    text = BRIDGE_MODULE.read_text(encoding="utf-8")
    assert _MEMBER_ON_BRIDGE.search(text), "the scan found no bridge access at all"
    assert unknown_bridge_members(text, load_contract()) == set()


def test_feature_table_matches_the_contract():
    assert feature_table_errors(BRIDGE_MODULE.read_text(encoding="utf-8"), load_contract()) == set()


def test_health_still_answers_the_fields_a_shell_reads():
    keys = health_response_keys(MAIN_PY.read_text(encoding="utf-8"))
    assert HEALTH_FIELDS - keys == set()


# The rails above against planted defects: each must be able to say no.
_CONTRACT = {
    "methods": sorted(RELEASED_METHODS),
    "properties": ["bridgeVersion", "capabilities"],
    "capabilities": sorted(RELEASED_CAPABILITIES),
}


def test_rail_refuses_a_removed_method():
    gutted = {**_CONTRACT, "methods": [m for m in _CONTRACT["methods"] if m != "ackBeforeQuit"]}
    assert missing_released(gutted) == {"ackBeforeQuit"}


def test_rail_refuses_a_removed_capability():
    gutted = {**_CONTRACT, "capabilities": ["window-state"]}
    assert missing_released(gutted) == {"before-quit"}


def test_rail_catches_an_unknown_feature_call():
    assert unknown_feature_calls("hasDesktopFeature('teleport')", _CONTRACT) == {"teleport"}
    assert unknown_feature_calls("hasDesktopFeature('window-state')", _CONTRACT) == set()


def test_rail_catches_an_unknown_bridge_member():
    assert unknown_bridge_members("b.teleport()", _CONTRACT) == {"teleport"}
    assert unknown_bridge_members("b.getInfo()", _CONTRACT) == set()


def test_rail_catches_get_bridge_member_and_computed_forms():
    assert unknown_bridge_members("getBridge().teleport()", _CONTRACT) == {"teleport"}
    assert unknown_bridge_members("getBridge().ackBeforeQuit()", _CONTRACT) == set()
    assert unknown_bridge_members("getBridge()[name](cb)", _CONTRACT) == {
        "getBridge()[...]: a computed member the scan cannot read"
    }


def test_rail_refuses_violations_planted_in_a_temporary_copy(tmp_path):
    copy = tmp_path / "desktopBridge.js"
    copy.write_text(
        BRIDGE_MODULE.read_text(encoding="utf-8") + "\ngetBridge().teleport()\ngetBridge()['warp']()\n",
        encoding="utf-8",
    )
    planted = unknown_bridge_members(copy.read_text(encoding="utf-8"), load_contract())
    assert "teleport" in planted
    assert "getBridge()[...]: a computed member the scan cannot read" in planted


def test_rail_refuses_member_access_planted_in_a_copy_of_the_exempt_file(tmp_path):
    copy = tmp_path / "webPush.js"
    copy.write_text(
        (REPO / "app" / "src" / "utils" / "webPush.js").read_text(encoding="utf-8")
        + "\nwin.uctDesktop.getInfo()\n",
        encoding="utf-8",
    )
    assert global_member_accesses(copy.read_text(encoding="utf-8")) != []


def test_rail_catches_a_feature_table_that_drifted():
    table = "const FEATURE_METHODS = {\n  'teleport': ['warp'],\n}"
    assert feature_table_errors(table, _CONTRACT) == {"teleport", "warp"}
    assert feature_table_errors("nothing here", _CONTRACT) == {"FEATURE_METHODS table not found"}


def test_rail_reads_the_health_response():
    assert health_response_keys("def health():\n    return {'status': 'ok'}\n") == {"status"}
