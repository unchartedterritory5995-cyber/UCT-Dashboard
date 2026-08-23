"""Wave 5 read-only smoke test: three sources (pattern_join, darkpool_agg, opt_flow),
13 columns + 2 carrier keys, honest absence reporting.

Uses tmp SCREENER_DB_PATH, PATTERN_DB_PATH, RAILWAY_VOLUME_MOUNT_PATH,
and SCREENER_OPTFLOW_ARTIFACT env BEFORE imports. Mirrors wave2 honesty + wave4 join state.

Stage B (B3) appends three verification checks after the Stage-A section:
  B-1  filters.meta() serves 145 filters (125 through Wave 4 + 12 Wave-5 +
       1 accdis enum [Wave-6 T1] + 4 finviz parity [Wave-6 T6] + 3 finviz
       growth trio [Wave-6 parity2]) and all 12 Wave-5 keys plus the 7 Wave-6
       keys are present. On a count mismatch it reports the measured number
       and the per-category breakdown (the WHY) instead of forcing the pin.
  B-2  the Python formula lane resolves a PROMOTED scalar: ast_table.scalar_source
       ("float_pct") -> {store: screener_rows, column: float_pct} (B1's manifest bump).
  B-3  tools/ast_conformance.py --coverage and --check both exit 0 (run as
       subprocesses from the repo root, same interpreter)."""
import json
import os
import sys
import tempfile
from pathlib import Path
from datetime import datetime

def run_smoke():
    """Run the smoke test. Exit 0 on all-green, 1 on any deviation."""

    # Create temp directory
    tmp_path = tempfile.mkdtemp()
    try:
        # Pin all env vars BEFORE any imports
        tmp_screener_db = Path(tmp_path) / "screener.db"
        tmp_pattern_db = Path(tmp_path) / "patterns.db"
        tmp_railway_vol = Path(tmp_path) / "railway_volume"
        tmp_opt_flow = Path(tmp_path) / "opt_flow.json"

        tmp_railway_vol.mkdir(parents=True, exist_ok=True)

        os.environ["SCREENER_DB_PATH"] = str(tmp_screener_db)
        os.environ["PATTERN_DB_PATH"] = str(tmp_pattern_db)
        os.environ["RAILWAY_VOLUME_MOUNT_PATH"] = str(tmp_railway_vol)
        os.environ["SCREENER_OPTFLOW_ARTIFACT"] = str(tmp_opt_flow)

        # NOW import (so the modules read the pinned env)
        from api.services.screener import (
            snapshot_db, snapshot_builder, pattern_join, darkpool_agg, opt_flow
        )
        from api.services.pattern_engine import pattern_db
        from api import darkpool_db

        # Initialize databases
        snapshot_db.init_db()
        pattern_db.init_db()
        darkpool_db.init_db()

        # Seed screener_rows with 3 tickers
        conn_screener = snapshot_db.connect()
        try:
            for ticker, price in (("NVDA", 100.0), ("AMD", 50.0), ("TSLA", 200.0)):
                conn_screener.execute(
                    "INSERT INTO screener_rows (ticker, price, snapshot_date, built_at) "
                    "VALUES (?,?,?,?)", (ticker, price, "2026-08-20", 1))
            conn_screener.commit()
        finally:
            conn_screener.close()

        # Seed patterns.db with two detections
        import sqlite3
        import uuid

        now_seconds = int(datetime.utcnow().timestamp())
        detected_at_1 = now_seconds - 86400  # 1 day ago
        detected_at_2 = now_seconds - 172800  # 2 days ago

        conn_pattern = pattern_db.get_connection()
        try:
            # Detection 1: WITH levels (entry and stop)
            det_id_1 = str(uuid.uuid4())
            levels_1 = json.dumps({"entry": 110.0, "stop": 95.0, "target": 130.0})
            conn_pattern.execute("""
                INSERT INTO pattern_detections
                (id, sym, tf, pattern_id, category, direction, start_t, end_t,
                 confidence, quality_json, geometry_json, levels_json, context_json,
                 narrative_json, status, detected_at, last_seen_at, hash_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (det_id_1, "NVDA", "D", "bull_flag_001", "bull_flag", "bullish",
                  detected_at_1, detected_at_1 + 3600, 85.0, "{}", "{}", levels_1,
                  "{}", "{}", "ready", detected_at_1, now_seconds, "hash_" + det_id_1[:8]))

            # Stats for detection 1
            conn_pattern.execute("""
                INSERT INTO pattern_stats
                (pattern_id, tf, regime_bucket, n_total, n_resolved, n_entry_hit,
                 n_target_hit, n_stop_hit, hit_rate, expectancy_r, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ("bull_flag_001", "D", "unknown", 100, 65, 65, 40, 10,
                  0.65, 0.3, now_seconds))

            # Detection 2: WITHOUT levels (no entry/stop)
            det_id_2 = str(uuid.uuid4())
            conn_pattern.execute("""
                INSERT INTO pattern_detections
                (id, sym, tf, pattern_id, category, direction, start_t, end_t,
                 confidence, quality_json, geometry_json, levels_json, context_json,
                 narrative_json, status, detected_at, last_seen_at, hash_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (det_id_2, "AMD", "D", "vcp_002", "vcp", "bearish",
                  detected_at_2, detected_at_2 + 3600, 60.0, "{}", "{}", "{}",
                  "{}", "{}", "forming", detected_at_2, now_seconds, "hash_" + det_id_2[:8]))

            # Stats for detection 2
            conn_pattern.execute("""
                INSERT INTO pattern_stats
                (pattern_id, tf, regime_bucket, n_total, n_resolved, n_entry_hit,
                 n_target_hit, n_stop_hit, hit_rate, expectancy_r, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ("vcp_002", "D", "unknown", 50, 25, 12, 5, 8,
                  0.48, 0.0, now_seconds))

            conn_pattern.commit()
        finally:
            conn_pattern.close()

        # Seed darkpool.db with two sessions
        conn_dp = darkpool_db.get_conn()
        try:
            # Session 1: For NVDA
            conn_dp.execute("""
                INSERT INTO darkpool_trades
                (date, timestamp, ticker, volume, price, pct_avg30, notional,
                 message, type, security_type, industry, sector, avg30day,
                 float_shares, earnings_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ("8/20/2026", "14:30:00", "NVDA", 100000.0, 100.5, 50.0, 5_000_000.0,
                  "Block print", "trade", "common", "Computer Hardware", "Technology",
                  10_000_000.0, 2_000_000.0, "2026-08-20"))

            # Session 2: For AMD
            conn_dp.execute("""
                INSERT INTO darkpool_trades
                (date, timestamp, ticker, volume, price, pct_avg30, notional,
                 message, type, security_type, industry, sector, avg30day,
                 float_shares, earnings_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, ("8/20/2026", "15:00:00", "AMD", 75000.0, 50.2, 35.0, 3_500_000.0,
                  "Block trade", "trade", "common", "Semiconductors", "Technology",
                  5_000_000.0, 1_500_000.0, None))

            # Add a few more prints for the 5-day window
            for i in range(2):
                conn_dp.execute("""
                    INSERT INTO darkpool_trades
                    (date, timestamp, ticker, volume, price, pct_avg30, notional,
                     message, type, security_type, industry, sector, avg30day,
                     float_shares, earnings_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, ("8/19/2026", f"14:0{i}:00", "NVDA", 50000.0 * (i+1), 99.5, 40.0,
                      2_500_000.0 * (i+1), "Block print", "trade", "common",
                      "Computer Hardware", "Technology", 10_000_000.0, 2_000_000.0, None))

            conn_dp.commit()
        finally:
            conn_dp.close()

        # Create opt-flow artifact with correct structure (minimum 25 tickers)
        opt_flow_rows = {
            "NVDA": {
                "opt_net_premium_1d": 1_000_000.0,
                "opt_bull_pct_1d": 62.5,
                "opt_net_premium_5d": 4_200_000.0
            },
            "TSLA": {
                "opt_net_premium_1d": 800_000.0,
                "opt_bull_pct_1d": 55.0,
                "opt_net_premium_5d": 3_000_000.0
            },
        }

        # Add 23 more tickers to reach minimum of 25
        for i, sym in enumerate(["AAPL", "MSFT", "GOOG", "AMZN", "META",
                                 "AVGO", "ASML", "TSM", "ADBE", "ORCL",
                                 "ACN", "NFLX", "QCOM", "IBM", "INTC",
                                 "BA", "GE", "CAT", "MMM", "HON",
                                 "TXN", "AMD", "PYPL"]):
            opt_flow_rows[sym] = {
                "opt_net_premium_1d": (500_000.0 + i * 10000.0),
                "opt_bull_pct_1d": (50.0 + i * 0.5),
                "opt_net_premium_5d": (1_500_000.0 + i * 30000.0)
            }

        opt_flow_data = {
            "as_of": now_seconds,
            "rows": opt_flow_rows
        }

        with open(tmp_opt_flow, "w") as f:
            json.dump(opt_flow_data, f)

        print("=" * 70)
        print("SMOKE TEST: Wave 5 Read-Only Verification")
        print("=" * 70)
        print(f"\nEnvironment:")
        print(f"  SCREENER_DB_PATH: {tmp_screener_db}")
        print(f"  PATTERN_DB_PATH: {tmp_pattern_db}")
        print(f"  RAILWAY_VOLUME_MOUNT_PATH: {tmp_railway_vol}")
        print(f"  SCREENER_OPTFLOW_ARTIFACT: {tmp_opt_flow}")

        # Read the three Wave 5 sources
        print("\n[READING SOURCES]")

        sources = {}
        readers = {
            "pattern_join": pattern_join.read_pattern_fields,
            "darkpool_agg": darkpool_agg.read_darkpool_fields,
            "opt_flow": opt_flow.read_opt_flow_fields,
        }

        maps = {}
        tickers = ["NVDA", "AMD", "TSLA"]

        for name, fn in readers.items():
            try:
                if name == "darkpool_agg":
                    # darkpool_agg needs prev_closes (the closes kwarg)
                    prev_closes = {"NVDA": 100.0, "AMD": 50.0, "TSLA": 200.0}
                    maps[name] = fn(tickers, closes=prev_closes, failures=sources)
                else:
                    maps[name] = fn(tickers, failures=sources)
                print(f"  {name}: OK ({len(maps[name])} tickers)")
            except Exception as exc:
                maps[name] = {}
                sources.setdefault(name, {})[type(exc).__name__] = 1
                print(f"  {name}: ABSENT ({type(exc).__name__})")

        print(f"\nSource presence: {{{', '.join(f'{k}: {bool(v)}' for k, v in maps.items())}}}")
        if sources:
            print(f"Failure census: {sources}")
        else:
            print(f"Failure census: {{}}")

        # Compose market_row and build rows
        print("\n[BUILDING ROWS]")

        census = {}
        spy_closes = snapshot_builder._read_spy_closes()
        rows_built = 0

        for ticker in tickers:
            # Read bars for this ticker
            bars = snapshot_builder._read_daily_bars(ticker)
            if not bars:
                print(f"  {ticker}: no bars available (skipped)")
                continue

            # Merge all Wave 5 sources into market_row
            market_row = {}
            for source_map in maps.values():
                if ticker.upper() in source_map:
                    market_row.update(source_map[ticker.upper()])

            # Build the row
            try:
                row = snapshot_builder.build_row(
                    ticker, bars, None, None,
                    market_row=market_row if market_row else None,
                    spy_closes=spy_closes
                )
                rows_built += 1

                # Census Wave 5 columns
                wave5_cols = [
                    "pattern_engine_ids", "pattern_engine_conf", "pattern_engine_dir",
                    "pattern_entry_dist_pct", "pattern_stop_dist_pct", "pattern_expectancy_r",
                    "dp_notional_1d", "dp_prints_1d", "dp_notional_5d", "dp_level_dist_pct",
                    "opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d",
                ]

                for col in wave5_cols:
                    if col in row and row[col] is not None:
                        census[col] = census.get(col, 0) + 1

                print(f"  {ticker}: OK")
            except Exception as e:
                print(f"  {ticker}: FAIL ({e})")
                import traceback
                traceback.print_exc()
                return 1

        # Report census
        print(f"\nRows built: {rows_built}")
        print("\nWave 5 Column Presence (13 columns):")

        wave5_cols = [
            "pattern_engine_ids", "pattern_engine_conf", "pattern_engine_dir",
            "pattern_entry_dist_pct", "pattern_stop_dist_pct", "pattern_expectancy_r",
            "dp_notional_1d", "dp_prints_1d", "dp_notional_5d", "dp_level_dist_pct",
            "opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d",
        ]

        present_count = 0
        for col in wave5_cols:
            count = census.get(col, 0)
            present_count += 1 if count > 0 else 0
            status = f"{count}/{rows_built}" if rows_built > 0 else "0/0"
            print(f"  {col}: {status}")

        print(f"\nSummary: {present_count}/13 Wave 5 columns present")

        # Verify at least one source provided data (honest absence reporting)
        sources_with_data = sum(1 for m in maps.values() if m)
        if sources_with_data == 0 and sources:
            print("\n[Sources absent — failure reasons reported]")
            for source_name, errors in sources.items():
                print(f"  {source_name}: {errors}")

        if rows_built < 1:
            print("\n[FAIL] No rows built")
            return 1

        # ------------------------------------------------------------------
        # STAGE B (B3): filter vocabulary + formula lane + conformance gates
        # ------------------------------------------------------------------
        print("\n" + "=" * 70)
        print("STAGE B: meta count / promoted-scalar resolution / conformance gates")
        print("=" * 70)

        # [B-1] filters.meta() count -- 145 expected (125 through Wave 4 +
        # 12 Wave 5 + 1 accdis enum [Wave-6 T1] + 4 finviz parity [Wave-6 T6]
        # + 3 finviz growth trio [Wave-6 parity2]).
        # Pin history: B3 pinned 137 pre-Wave-6; T1's accdis enum moved the
        # measured count to 138; T6's four moved it to 142; parity2's growth
        # trio (ids 19/20/21; Q/Q pair deliberately SKIPPED -- eps_growth/
        # rev_growth already carry those facts) moved it to 145, each time
        # WITH the pin.
        # Called WITHOUT user_id on purpose: the per-user my_scans entry would
        # inflate the count by one and the pin is about the shared vocabulary.
        print("\n[STAGE B-1] filters.meta() count (expect 145 = 125 + 12 + 1 + 4 + 3)")
        from api.services.screener import filters
        meta_out = filters.meta()
        meta_keys = [f["key"] for f in meta_out["filters"]]
        meta_count = len(meta_keys)
        print(f"  measured: {meta_count}")

        wave5_filter_keys = {
            "pattern_engine_conf", "pattern_engine_dir", "pattern_entry_dist_pct",
            "pattern_stop_dist_pct", "pattern_expectancy_r",
            "dp_notional_1d", "dp_prints_1d", "dp_notional_5d", "dp_level_dist_pct",
            "opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d",
        }
        wave6_t6_filter_keys = {
            "insider_trans_pct", "inst_trans_pct", "optionable", "shortable",
            # Wave-6 parity2 growth trio rides the same presence check.
            "eps_past_5y_growth", "eps_next_5y_growth", "sales_past_5y_growth",
        }
        missing_wave5 = sorted(wave5_filter_keys - set(meta_keys))
        missing_wave6 = sorted(wave6_t6_filter_keys - set(meta_keys))
        if meta_count != 145 or missing_wave5 or missing_wave6:
            # Report the measured number and WHY -- never force the pin.
            from collections import Counter
            by_cat = Counter(f["category"] for f in meta_out["filters"])
            print(f"  [FAIL] measured {meta_count} filters (expected 145); "
                  f"Wave-5 keys missing: {missing_wave5 or 'none'}; "
                  f"Wave-6 keys missing: {missing_wave6 or 'none'}")
            print(f"  Per-category breakdown (the WHY): {dict(sorted(by_cat.items()))}")
            dupes = sorted(k for k, n in Counter(meta_keys).items() if n > 1)
            if dupes:
                print(f"  Duplicate keys: {dupes}")
            return 1
        print(f"  all 12 Wave-5 + 7 Wave-6 filter keys present")
        print("  [PASS]")

        # [B-2] promoted-scalar resolution via the Python lane (ast closedTable):
        # float_pct was PROMOTED by B1 (Wave-2 exclusion deleted, scalar declared),
        # so a formula naming it must resolve to the screener_rows column.
        print("\n[STAGE B-2] promoted scalar resolves (ast_table.scalar_source)")
        from api.services import ast_table
        try:
            src = dict(ast_table.scalar_source("float_pct"))
        except KeyError:
            print("  [FAIL] float_pct is not a declared scalar "
                  "(closedTable promotion missing?)")
            return 1
        print(f"  float_pct -> {src}")
        if src != {"store": "screener_rows", "column": "float_pct"}:
            print("  [FAIL] expected {'store': 'screener_rows', 'column': 'float_pct'}")
            return 1
        print("  [PASS]")

        # [B-3] the conformance gates: --coverage (manifest totality) and --check
        # (two-lane digest gate) must BOTH exit 0. Run from the repo root with the
        # same interpreter; the tmp env pins are inherited and harmless (the tool
        # reads closedTable.json + committed fixtures, never a data root).
        print("\n[STAGE B-3] ast_conformance --coverage / --check both green")
        import subprocess
        repo_root = Path(__file__).resolve().parents[1]
        tool = repo_root / "tools" / "ast_conformance.py"
        for flag in ("--coverage", "--check"):
            proc = subprocess.run(
                [sys.executable, str(tool), flag],
                cwd=str(repo_root), capture_output=True, text=True, timeout=600)
            tail = (proc.stdout or "").strip().splitlines()[-1:] or ["<no output>"]
            if proc.returncode != 0:
                print(f"  {flag}: [FAIL] exit {proc.returncode}")
                print("  --- stdout tail ---")
                for line in (proc.stdout or "").strip().splitlines()[-15:]:
                    print(f"  {line}")
                print("  --- stderr tail ---")
                for line in (proc.stderr or "").strip().splitlines()[-15:]:
                    print(f"  {line}")
                return 1
            print(f"  {flag}: exit 0 -- {tail[0]}")
        print("  [PASS]")

        print("\n" + "=" * 70)
        print("ALL TESTS PASSED")
        print("=" * 70)
        return 0

    except Exception as e:
        print(f"\n[FATAL]: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        # Clean up
        import shutil
        try:
            shutil.rmtree(tmp_path, ignore_errors=True)
        except:
            pass


if __name__ == "__main__":
    sys.exit(run_smoke())
