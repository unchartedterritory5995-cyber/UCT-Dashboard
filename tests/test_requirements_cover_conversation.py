"""⛔ RELEASE GATE 2026-10-06 — `jsonschema` was imported by the P2 conversation door
but absent from requirements.txt: the local venv had it, the production image did
not, and POST /api/user-definitions/converse 500'd in production
(ModuleNotFoundError). Every third-party module the conversation door imports must
be declared where the production image installs from."""
import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOORS = ["api/services/definition_conversation.py", "api/services/presentation_schema.py"]


def _declared():
    text = (ROOT / "requirements.txt").read_text(encoding="utf-8").lower()
    return {n.replace("_", "-") for n in re.findall(r"^([a-z0-9_.\-]+)", text, re.M)}


def test_every_third_party_import_of_the_conversation_door_is_declared():
    declared = _declared()
    missing = []
    for rel in DOORS:
        tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            mods = ([a.name for a in node.names] if isinstance(node, ast.Import)
                    else [node.module] if isinstance(node, ast.ImportFrom) and node.module and node.level == 0
                    else [])
            for m in mods:
                top = m.split(".")[0]
                if top in sys.stdlib_module_names or top == "api":
                    continue
                if top.lower().replace("_", "-") not in declared:
                    missing.append((rel, top))
    assert missing == [], f"undeclared in requirements.txt: {missing}"
