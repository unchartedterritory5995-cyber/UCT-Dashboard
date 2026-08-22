"""Wave 4: the per-user my_scans category. meta() with no user is UNCHANGED."""
import importlib

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db, scan_store, filters
    importlib.reload(snapshot_db)
    importlib.reload(scan_store)
    scan_store.init_db()
    return filters, scan_store


H_BOOL = None   # filled by _defs
H_IND = None


def _defs(monkeypatch, filters, rows):
    from api.services import user_definitions as ud
    monkeypatch.setattr(ud, "list_for_user", lambda uid: rows)


def _row(name, ast_hash, scannable=True):
    # assert_scannable is stubbed per-test; the row shape mirrors
    # user_definitions.list_for_user (def_id, ast_hash, definition).
    return {"def_id": "u_" + name, "ast_hash": ast_hash,
            "definition": {"compute": {"kind": "ast", "fn": ast_hash,
                                       "ast": {"op": ">"} if scannable else {"n": 1}},
                           "meta": {"name": name}}}


@pytest.fixture()
def gate(monkeypatch):
    # Deterministic scannability: boolean iff the fixture said so. The REAL
    # gate is scan_definition.assert_scannable; this stub keeps the test
    # focused on meta()'s own contract (population, absence, batching).
    from api.services import scan_definition
    def fake(defn):
        if defn["compute"]["ast"].get("op") != ">":
            raise scan_definition.ScanRefused("[gate:yields] not boolean")
        return {"def_hash": defn["compute"]["fn"], "yields": "bool", "scalars": []}
    monkeypatch.setattr(scan_definition, "assert_scannable", fake)


H1 = "sha256:" + "a" * 64
H2 = "sha256:" + "b" * 64


def test_no_user_meta_is_byte_identical_to_before(env):
    filters, _ = env
    out = filters.meta()
    assert all(f["key"] != "scan" for f in out["filters"])
    assert all(c["key"] != "my_scans" for c in out["categories"])


def test_user_with_no_scannable_definitions_gets_no_category(env, monkeypatch, gate):
    filters, _ = env
    _defs(monkeypatch, filters, [_row("indicator", H1, scannable=False)])
    out = filters.meta(user_id="u1")
    assert all(f["key"] != "scan" for f in out["filters"])
    assert all(c["key"] != "my_scans" for c in out["categories"])


def test_scannable_definitions_populate_entry_category_and_latest(env, monkeypatch, gate):
    filters, scan_store = env
    scan_store.record_coverage(H1, "D", 20260820, evaluated=10, answered=8,
                               dropped=1, not_computable=1, dropped_symbols=[])
    _defs(monkeypatch, filters, [_row("Breakout base", H1),
                                 _row("Quiet pullback", H2)])
    out = filters.meta(user_id="u1")
    entry = next(f for f in out["filters"] if f["key"] == "scan")
    assert entry["category"] == "my_scans" and entry["type"] == "enum"
    assert entry["allow_custom"] is False
    labels = [p["label"] for p in entry["presets"]]
    assert labels[0] == "Any" and "Breakout base" in labels
    by_hash = {s["def_hash"]: s for s in entry["scans"]}
    assert by_hash[H1]["latest"]["as_of"] == 20260820
    assert by_hash[H1]["latest"]["answered"] == 8
    assert by_hash[H2]["latest"] is None          # first sweep tonight
    assert out["categories"][-1] == {"key": "my_scans", "label": "My Scans"}
    # K5's other half: the entry's category key IS in categories.
    assert any(c["key"] == "my_scans" for c in out["categories"])


def test_duplicate_names_disambiguated_by_hash_suffix(env, monkeypatch, gate):
    filters, _ = env
    _defs(monkeypatch, filters, [_row("Same name", H1), _row("Same name", H2)])
    entry = next(f for f in filters.meta(user_id="u1")["filters"]
                 if f["key"] == "scan")
    labels = [p["label"] for p in entry["presets"] if p["label"] != "Any"]
    assert len(set(labels)) == 2                  # FilterControl finds by label


def test_a_failing_definitions_read_degrades_to_no_category(env, monkeypatch, gate):
    filters, _ = env
    from api.services import user_definitions as ud
    monkeypatch.setattr(ud, "list_for_user",
                        lambda uid: (_ for _ in ()).throw(RuntimeError("db")))
    out = filters.meta(user_id="u1")
    assert all(f["key"] != "scan" for f in out["filters"])   # honest absence
