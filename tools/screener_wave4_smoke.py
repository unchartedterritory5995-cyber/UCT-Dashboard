"""Wave 4 read-only smoke test: four join states + per-user category.

Uses a tmp SCREENER_DB_PATH, never the default /data path.
"""
import os
import sys
import tempfile
import contextlib
import importlib
from pathlib import Path

def run_smoke():
    """Run the smoke test. Exit 0 on all-green, 1 on any deviation."""

    # Create temp database
    tmp_path = tempfile.mkdtemp()
    try:
        tmp_db = Path(tmp_path) / "screener.db"
        os.environ["SCREENER_DB_PATH"] = str(tmp_db)

        # Force reload with temp path
        from api.services.screener import snapshot_db, scan_store, query, filters
        importlib.reload(snapshot_db)
        importlib.reload(scan_store)
        importlib.reload(query)
        importlib.reload(filters)

        # Initialize databases
        snapshot_db.init_db()
        scan_store.init_db()

        # Seed 3 screener_rows
        conn = snapshot_db.connect()
        try:
            for ticker, price in (("NVDA", 100.0), ("AMD", 50.0), ("TSLA", 200.0)):
                conn.execute(
                    "INSERT INTO screener_rows (ticker, price, snapshot_date, built_at) "
                    "VALUES (?,?,?,?)", (ticker, price, "2026-08-20", 1))
            conn.commit()
        finally:
            conn.close()

        # Test hashes
        H1 = "sha256:" + "a" * 64
        H2 = "sha256:" + "b" * 64

        # Record two swept sessions for H1, zero for H2
        scan_store.record_hits(H1, "D", 20260818, ["NVDA", "AMD", "TSLA"])
        scan_store.record_coverage(H1, "D", 20260818, evaluated=3, answered=3,
                                   dropped=0, not_computable=0, dropped_symbols=[])

        scan_store.record_hits(H1, "D", 20260820, ["NVDA"])  # Latest for H1
        scan_store.record_coverage(H1, "D", 20260820, evaluated=3, answered=3,
                                   dropped=0, not_computable=0, dropped_symbols=[])

        # H2 has zero coverage records (never swept)

        print("=" * 70)
        print("SMOKE TEST: Wave 4 Read-Only Verification")
        print("=" * 70)

        # Test 1: Single hash
        print("\n[TEST 1] Single hash scan (H1 latest coverage)")
        try:
            out1 = query.run_scan({"filters": [{"key": "scan", "op": "in", "value": H1}]})
            rows1 = [r["ticker"] for r in out1["rows"]]
            print(f"  rows: {rows1}")
            print(f"  total: {out1['total']}")
            print(f"  scan_joins: {out1['scan_joins']}")
            assert rows1 == ["NVDA"], f"Expected ['NVDA'], got {rows1}"
            assert out1["total"] == 1, f"Expected total=1, got {out1['total']}"
            assert len(out1["scan_joins"]) == 1, f"Expected 1 join, got {len(out1['scan_joins'])}"
            assert out1["scan_joins"][0]["def_hash"] == H1
            assert out1["scan_joins"][0]["as_of"] == 20260820
            assert out1["scan_joins"][0]["applied"] == True
            print("  [PASS]")
        except Exception as e:
            print(f"  [FAIL]: {e}")
            return 1

        # Test 2: Two-hash AND (each at its own latest)
        print("\n[TEST 2] Two-hash AND (divergent latests)")
        try:
            out2 = query.run_scan({"filters": [
                {"key": "scan", "op": "in", "value": [H1, H2]}]})
            rows2 = [r["ticker"] for r in out2["rows"]]
            print(f"  rows: {rows2}")
            print(f"  total: {out2['total']}")
            print(f"  scan_joins: {out2['scan_joins']}")
            assert rows2 == ["NVDA"], f"Expected ['NVDA'], got {rows2}"
            assert out2["total"] == 1, f"Expected total=1, got {out2['total']}"
            joins = {j["def_hash"]: j for j in out2["scan_joins"]}
            assert H1 in joins and H2 in joins, f"Missing H1 or H2 in joins"
            assert joins[H1]["as_of"] == 20260820
            assert joins[H2]["as_of"] is None, f"Expected H2 as_of=None (never swept)"
            assert joins[H2]["applied"] == False, f"Expected H2 applied=False"
            print("  [PASS]")
        except Exception as e:
            print(f"  [FAIL]: {e}")
            return 1

        # Test 3: Never-swept hash is disclosed (not silent)
        print("\n[TEST 3] Never-swept disclosed (H2 has no coverage)")
        try:
            out3 = query.run_scan({"filters": [
                {"key": "scan", "op": "in", "value": [H1, H2]}]})
            joins3 = {j["def_hash"]: j for j in out3["scan_joins"]}
            print(f"  H2 join: {joins3.get(H2)}")
            assert joins3[H2] == {"def_hash": H2, "as_of": None, "applied": False}, \
                f"Expected H2 disclosed as never-swept, got {joins3[H2]}"
            print("  [PASS]")
        except Exception as e:
            print(f"  [FAIL]: {e}")
            return 1

        # Test 4: Empty/malformed value REFUSES (not silent noop)
        print("\n[TEST 4] Empty/malformed values are REFUSED")
        try:
            refusal_count = 0
            for bad in (None, "", [], [""], [None], 7):
                try:
                    query.run_scan({"filters": [{"key": "scan", "op": "in", "value": bad}]})
                    print(f"  [FAIL]: {bad} should have raised ValueError")
                    return 1
                except ValueError as e:
                    refusal_count += 1
                    print(f"  Expected refusal on {repr(bad)}: {e}")
            assert refusal_count == 6, f"Expected 6 refusals, got {refusal_count}"
            print("  [PASS] (all bad values refused)")
        except Exception as e:
            print(f"  [FAIL]: {e}")
            return 1

        # Test 5: Per-user category via filters.meta()
        print("\n[TEST 5] Per-user my_scans category")
        try:
            # Monkeypatch user_definitions.list_for_user
            from api.services import user_definitions, scan_definition

            def fake_assert_scannable(defn):
                """Stub: everything with ast.op='>' is scannable."""
                if defn["compute"]["ast"].get("op") != ">":
                    raise scan_definition.ScanRefused("[gate:yields] not boolean")
                return {"def_hash": defn["compute"]["fn"], "yields": "bool", "scalars": []}

            # Patch scan_definition.assert_scannable
            import unittest.mock
            with unittest.mock.patch.object(scan_definition, "assert_scannable", fake_assert_scannable):
                # Define two definitions: one scannable, one not
                def_scannable = {
                    "def_id": "u_breakout",
                    "ast_hash": H1,
                    "definition": {
                        "compute": {"kind": "ast", "fn": H1, "ast": {"op": ">"}},
                        "meta": {"name": "Breakout base"}
                    }
                }
                def_not_scannable = {
                    "def_id": "u_indicator",
                    "ast_hash": H2,
                    "definition": {
                        "compute": {"kind": "ast", "fn": H2, "ast": {"n": 1}},
                        "meta": {"name": "Indicator"}
                    }
                }

                with unittest.mock.patch.object(user_definitions, "list_for_user",
                                               return_value=[def_scannable, def_not_scannable]):
                    out5 = filters.meta(user_id="u1")

                    # Check that my_scans category exists
                    categories = out5.get("categories", [])
                    has_my_scans_cat = any(c["key"] == "my_scans" for c in categories)
                    print(f"  my_scans category present: {has_my_scans_cat}")
                    assert has_my_scans_cat, "Expected my_scans category in output"

                    # Check that scan filter exists
                    scan_filter = next((f for f in out5.get("filters", [])
                                       if f["key"] == "scan"), None)
                    print(f"  scan filter present: {scan_filter is not None}")
                    assert scan_filter is not None, "Expected scan filter in output"

                    if scan_filter:
                        print(f"  scan filter category: {scan_filter.get('category')}")
                        assert scan_filter.get("category") == "my_scans", \
                            f"Expected category='my_scans', got {scan_filter.get('category')}"

                        scans = scan_filter.get("scans", [])
                        print(f"  scans in filter: {len(scans)}")
                        assert len(scans) == 1, f"Expected 1 scannable, got {len(scans)}"

                        scan_h1 = next((s for s in scans if s["def_hash"] == H1), None)
                        assert scan_h1 is not None, "Expected H1 in scans"
                        print(f"  H1 latest: {scan_h1.get('latest')}")
                        assert scan_h1["latest"]["as_of"] == 20260820, \
                            f"Expected as_of=20260820, got {scan_h1['latest']['as_of']}"
                        assert scan_h1["latest"]["answered"] == 3, \
                            f"Expected answered=3, got {scan_h1['latest']['answered']}"

                    print("  [PASS]")
        except Exception as e:
            import traceback
            print(f"  [FAIL]: {e}")
            traceback.print_exc()
            return 1

        print("\n" + "=" * 70)
        print("ALL TESTS PASSED")
        print("=" * 70)
        return 0
    finally:
        # Clean up connections and temp directory
        try:
            import sqlite3
            sqlite3.reset_the_debug_flag()  # Reset any open connections
        except:
            pass
        import shutil
        try:
            shutil.rmtree(tmp_path, ignore_errors=True)
        except:
            pass

if __name__ == "__main__":
    sys.exit(run_smoke())
