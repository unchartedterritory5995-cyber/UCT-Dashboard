"""TERM-076 (FB-A12-02) — the server half of the persistence manifest.

`app/src/lib/persistence/persistenceManifest.json` publishes which member settings follow the
ACCOUNT (cross-device) and which follow the BROWSER (device-local); the Settings card
"What syncs across your devices" renders from it. Its client half is railed in vitest
(`app/src/lib/persistence/persistenceManifest.test.js`), which derives every key from `app/src`
by AST.

This file owns the half vitest cannot see: the per-account preference keys the SERVER stores.
The authority is `_PREFERENCE_KEYS` in `api/routers/auth.py` — some of those keys are written
server-side only (`shared_tag_colors`), so no client census can find them — and it is read here
with Python's own `ast`, never a regex and never an import of the router (importing it would
pull the whole app in to read one dict literal).

Fix for every failure below, in one line:  node tools/persistence_census.mjs --write
"""
import ast
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH = os.path.join(ROOT, "api", "routers", "auth.py")
MANIFEST = os.path.join(ROOT, "app", "src", "lib", "persistence", "persistenceManifest.json")
FIX = "node tools/persistence_census.mjs --write"


def _server_keys(path=AUTH):
    with open(path, encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_PREFERENCE_KEYS" for t in node.targets
        ):
            return {k.value for k in node.value.keys}
    return None


def _manifest():
    with open(MANIFEST, encoding="utf-8") as fh:
        return json.load(fh)


def _declared_server_keys(manifest):
    return {e["key"] for e in manifest["entries"] if e["store"] == "server-preference"}


def test_the_allow_list_is_read_before_anything_is_compared():
    # Non-vacuity: an empty set satisfies every "nothing missing" assertion below.
    keys = _server_keys()
    assert keys, "could not read _PREFERENCE_KEYS from api/routers/auth.py"
    assert {"chart_settings", "tracings_doc", "shared_tag_colors"} <= keys


def test_every_server_preference_is_declared_in_the_manifest():
    missing = sorted(_server_keys() - _declared_server_keys(_manifest()))
    assert not missing, f"server preference keys missing from the manifest: {missing} — {FIX}"


def test_the_manifest_declares_no_server_preference_the_server_would_refuse():
    extra = sorted(_declared_server_keys(_manifest()) - _server_keys())
    assert not extra, (
        f"manifest lists server preferences that are not in _PREFERENCE_KEYS: {extra} — "
        f"either the key was retired ({FIX}) or the client writes a key the server 400s "
        "(tests/test_preference_key_validation.py)"
    )


def test_every_server_preference_is_published_as_cross_device():
    wrong = sorted(
        e["key"] for e in _manifest()["entries"]
        if e["store"] == "server-preference" and (e["scope"] != "cross-device" or not e.get("serverAllowlisted"))
    )
    assert not wrong, f"server preferences not published as cross-device + allow-listed: {wrong} — {FIX}"


def test_the_comparison_can_fail_by_name(tmp_path):
    # CONTROL: a manifest missing one real key must be reported, naming that key.
    m = _manifest()
    m["entries"] = [e for e in m["entries"] if not (e["store"] == "server-preference" and e["key"] == "shared_tag_colors")]
    assert "shared_tag_colors" in _server_keys() - _declared_server_keys(m)
    # …and the reader genuinely parses the file it is pointed at, not a cached set.
    fake = tmp_path / "auth.py"
    fake.write_text('_PREFERENCE_KEYS = {"only_this": "opaque"}\n', encoding="utf-8")
    assert _server_keys(str(fake)) == {"only_this"}
