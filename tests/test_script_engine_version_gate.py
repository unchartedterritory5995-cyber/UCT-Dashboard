"""DEPLOY-GATE rail: the server reads the saved-script engine number from the browser's
declaration (api/services/user_definitions.read_script_engine_version). If a bump writes
the declaration in a shape the reader cannot parse, the server silently reads None and
holds every refusal while the chart moves on (chart/alert disagreement). This runs in
.github/workflows/master-deploy-gate.yml so such a bump can never reach production.
Offline, stdlib-only import path."""
import pathlib

import pytest

from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = ROOT / "app/src/components/chart/engine/scriptEngineVersion.js"


def test_the_shipped_declaration_parses_to_one_positive_integer():
    v = svc.read_script_engine_version(JS)
    assert isinstance(v, int) and v >= 1, (
        "scriptEngineVersion.js must declare `export const SCRIPT_ENGINE_VERSION = <n>` exactly once")
    assert svc.SCRIPT_ENGINE_VERSION == v


@pytest.mark.parametrize("line,expected", [
    ("export const SCRIPT_ENGINE_VERSION = 2\n", 2),
    ("export const SCRIPT_ENGINE_VERSION = 2;\n", 2),
    ("export const  SCRIPT_ENGINE_VERSION  =  3 ;\n", 3),
    ("export const SCRIPT_ENGINE_VERSION = 4 // bumped for C48\n", 4),
    ("export const SCRIPT_ENGINE_VERSION = 5;  // note\n", 5),
])
def test_ordinary_ways_to_write_the_bump_all_parse(tmp_path, line, expected):
    p = tmp_path / "scriptEngineVersion.js"
    p.write_text("// header prose: SCRIPT_ENGINE_VERSION = 99\n" + line, encoding="utf-8")
    assert svc.read_script_engine_version(p) == expected
