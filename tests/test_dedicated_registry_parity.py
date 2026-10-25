"""Wave 10, armed at the be->impl merge (Task 10.14 review m-3, carried to the merge).

The seven ready-made dedicated kinds cross the wire twice, and both crossings are pinned here, in the merged
tree, reading BOTH sides (never a copy of either):

  * the payload a kind's server builder sends (`shelf_kinds.BUILDERS`) against the params the client registry
    KEEPS for that kind (`app/src/widgets/registry.js`, its `_dedicated(...)` schema plus `snapshotManifest`'s
    shared keys). A key the server sends and the registry does not list is dropped by `normalizeParams` on the
    first refresh -- the member never sees it. A key the registry lists and no builder can send is dead.
  * the settings each kind keeps (`lib/dedicatedWidgets.js` `DEDICATED_SETTINGS`) against `shelf_kinds.PARAMS`,
    the server's one authority for what a request may carry.

A builder's possible keys are what it sends for a member with no data, plus every key its body can add later
(a literal key assigned on the dict it returns, or passed to `.update`), read by AST so a branch the empty member
does not reach (`truncated`, `capped`, `notices`, ...) still counts.
"""
from __future__ import annotations

import ast
import importlib
import inspect
import re
import textwrap
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "app" / "src" / "widgets" / "registry.js"
DEDICATED = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "dedicatedWidgets.js"

#: The keys every snapshot kind carries whatever its schema (`snapshotManifest`): stamped by the server, or the
#: member's own switch.
_FRAME = {"asOf", "source", "share"}


def _registry_text() -> str:
    return REGISTRY.read_text(encoding="utf-8")


def _snap_common(text: str) -> set[str]:
    m = re.search(r"^const _SNAP_COMMON = '([^']*)'\.split\(' '\)", text, re.M)
    assert m, "registry.js: _SNAP_COMMON not found"
    return {tok.split(":")[0] for tok in m.group(1).split()}


def _dedicated_schemas(text: str) -> dict[str, set[str]]:
    """{kind: the keys of its `_dedicated(label, name, schema)` row}, `settings` and `lines` included (the
    `_dedicated` wrapper adds both)."""
    m = re.search(r"^const _dedicated = \(label, name, payloadSchema\) => snapshotManifest\(label, `([^`$]*)\$\{payloadSchema\}`",
                  text, re.M)
    assert m, "registry.js: the _dedicated wrapper changed shape"
    wrapper = {tok.split(":")[0] for tok in m.group(1).split()}
    out = {}
    for kind, body in re.findall(r"^\s*(my[A-Z]\w*): _dedicated\(\s*'[^']*',\s*'[^']*',\s*((?:'[^']*'\s*\+?\s*)+)\)",
                                 text, re.M):
        schema = " ".join(re.findall(r"'([^']*)'", body))
        out[kind] = wrapper | {tok.split(":")[0] for tok in schema.split()}
    return out


def _dedicated_settings() -> dict[str, list[str]]:
    text = DEDICATED.read_text(encoding="utf-8")
    m = re.search(r"export const DEDICATED_SETTINGS = Object\.freeze\(\{(.*?)\n\}\)", text, re.S)
    assert m, "dedicatedWidgets.js: DEDICATED_SETTINGS not found"
    return {k: re.findall(r"'([^']*)'", v)
            for k, v in re.findall(r"(\w+): Object\.freeze\(\[([^\]]*)\]\)", m.group(1))}


def _later_keys(fn) -> set[str]:
    """Every literal key the builder's body can put on a dict it RETURNS (a name in a `return <name>`): the
    literal keys of a dict assigned to that name, `name["k"] = ...` and `name.update(k=...)`. Read from the
    function's own source; a nested dict (a row, a check) is never counted."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    returned = {n.value.id for n in ast.walk(tree) if isinstance(n, ast.Return) and isinstance(n.value, ast.Name)}
    keys: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Assign, ast.AnnAssign)) and isinstance(n.value, ast.Dict):
            targets = n.targets if isinstance(n, ast.Assign) else [n.target]
            if any(isinstance(t, ast.Name) and t.id in returned for t in targets):
                keys |= {k.value for k in n.value.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)}
        elif isinstance(n, ast.Subscript) and isinstance(n.ctx, ast.Store) and isinstance(n.value, ast.Name)                 and n.value.id in returned and isinstance(n.slice, ast.Constant) and isinstance(n.slice.value, str):
            keys.add(n.slice.value)
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "update"                 and isinstance(n.func.value, ast.Name) and n.func.value.id in returned:
            keys |= {kw.arg for kw in n.keywords if kw.arg}
    return keys


@pytest.fixture
def builders(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import shelf_kinds
    yield shelf_kinds
    importlib.reload(auth_db)


NOW = datetime(2026, 10, 21, 15, tzinfo=timezone.utc)


def test_every_dedicated_kind_has_a_registry_row_and_a_builder(builders):
    schemas = _dedicated_schemas(_registry_text())
    assert set(schemas) == set(builders.BUILDERS) == set(builders.PARAMS)
    assert len(schemas) == 7


def test_the_payload_keys_a_builder_sends_are_the_keys_the_registry_keeps(builders):
    text = _registry_text()
    common = _snap_common(text)
    schemas = _dedicated_schemas(text)
    problems = {}
    for kind, build in builders.BUILDERS.items():
        sent = set(build("u-registry-parity", {}, NOW))
        assert {"asOf", "lines"} <= sent, kind                           # non-vacuity: a real payload
        possible = sent | _later_keys(build)
        kept = schemas[kind] | common | _FRAME
        dropped = possible - kept                                    # sendable, lost on refresh
        dead = schemas[kind] - {"settings"} - possible                 # listed, never sent
        if dropped or dead:
            problems[kind] = {"dropped by the client": sorted(dropped), "never sent": sorted(dead)}
    assert problems == {}


def test_dedicated_settings_are_shelf_kinds_params(builders):
    client = _dedicated_settings()
    server = {k: list(v) for k, v in builders.PARAMS.items() if v}
    assert client == server
    assert set(builders.PARAMS) - set(client) == {k for k, v in builders.PARAMS.items() if not v}


def test_the_readers_can_fail():
    """Controls: each reader sees a mismatch it is meant to see."""
    text = _registry_text()
    schemas = _dedicated_schemas(text)
    assert "windowMinutes" in schemas["myTiltCheck"] and "settings" in schemas["myTiltCheck"]
    assert "olderNotRead" in schemas["myRevengeClean"]          # a row continued with `+` is read whole
    broken = text.replace("'windowMinutes:n ", "'", 1)
    assert "windowMinutes" not in _dedicated_schemas(broken)["myTiltCheck"]
    assert _dedicated_settings()["myPropFirm"] == ["dailyLoss", "maxDrawdown", "since", "accountId"]

    def fake(user_id, params, now):
        row = {"nested": 1}
        out: dict = {"asOf": "x", "lines": [], "symbol": row}
        out["truncated"] = 1
        out.update(capped=True)
        return out
    assert _later_keys(fake) == {"asOf", "lines", "symbol", "truncated", "capped"}
