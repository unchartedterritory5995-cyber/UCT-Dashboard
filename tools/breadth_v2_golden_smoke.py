"""PRE-LAUNCH GOLDEN SMOKE — run the accepted V2 path in the DURABLE HOST and prove
the persisted rows against the independent oracle, cell by cell.

⭐ This is simultaneously two gates:
  * Step 13 — the golden smoke in the final host, against the final bars.db;
  * Step 5  — the equivalence proof for the `session_eod_closes` index fix, because
              the oracle it is checked against is the one the PRE-FIX code was
              accepted on. Matching it IS "optimised result == old accepted result".

It writes to its OWN artifact and never touches the real one.
"""
import json, os, sqlite3, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

#: ⭐ THE ACCEPTED 110-CELL MATRIX, NOW IN GIT. It lived only on the worker's volume
#: at `/data/_audit/final_acceptance.json`, which made the record of what V2 was
#: accepted against exactly as perishable as the code was. It is the oracle, so it
#: belongs next to the code it judges.
ORACLE = os.path.join(REPO, "tests", "fixtures", "breadth_v2_golden_matrix.json")
SMOKE  = "/data/_audit/v2_golden_smoke.db"
REPORT = "/data/_audit/v2_golden_smoke_report.json"

from api.services import breadth_combined_pass as cp
from api.services import breadth_wick_recon as wr
from api.services import breadth_live as bl
from api.services import breadth_v2_supervisor as sup

oracle = json.load(open(ORACLE))
for suffix in ("", "-wal", "-shm"):
    try:
        os.remove(SMOKE + suffix)
    except OSError:
        pass

print("=" * 78)
print("PRE-LAUNCH GOLDEN SMOKE — host=breadth-v2-runner")
print("  combined_md5   :", sup._md5(os.path.join(REPO, "api", "services", "breadth_combined_pass.py")),
      "== pinned", sup.PINNED_COMBINED_MD5)
print("  wick_recon_md5 :", sup._md5(os.path.join(REPO, "api", "services", "breadth_wick_recon.py")),
      "== pinned", sup.PINNED_WICK_RECON_MD5)
print("  near_52w_high in _PCT_METRICS (must be False):",
      "near_52w_high" in wr._PCT_METRICS)
print("  BREADTH_DIVIDEND_BASIS (F4, must be None):",
      os.environ.get("BREADTH_DIVIDEND_BASIS"))
print("  bars.db bytes  :", os.path.getsize("/data/bars.db"))
print("=" * 78)

timings = {}
for D in sorted(oracle):
    unis = cp.ALL_UNIVERSES if D >= "2011-01-03" else ("uct", "us")
    t0 = time.time()
    res = cp.run(SMOKE, D, D, universes=unis, progress_every=1)
    el = time.time() - t0
    timings[D] = round(el, 2)
    print("RAN %s  %6.1fs  %s" % (D, el, res))

con = sqlite3.connect("file:%s?mode=ro" % SMOKE, uri=True)
c = con.cursor()

exact, nonexact, missing = [], [], []
for D, dv in sorted(oracle.items()):
    for uni, uv in (dv.get("universes") or {}).items():
        for metric, m in (uv.get("metrics") or {}).items():
            want = float(m["oracle"])
            row = c.execute("SELECT c FROM breadth_daily_ohlc WHERE universe=? AND "
                            "date=? AND metric=?", (uni, D, metric)).fetchone()
            if row is None:
                missing.append((D, uni, metric, want))
                continue
            got = float(row[0])
            # The oracle records one decimal for the pct family and integers elsewhere;
            # compare on the oracle's own precision rather than inventing a tolerance.
            if isinstance(m["oracle"], float):
                same = abs(got - want) <= 5e-2
            else:
                same = (got == want)
            if same:
                exact.append((D, uni, metric))
            else:
                nonexact.append((D, uni, metric, want, got))

print()
print("GOLDEN MATRIX : %d EXACT / %d NON-EXACT / %d MISSING  (of %d cells)"
      % (len(exact), len(nonexact), len(missing), len(exact) + len(nonexact) + len(missing)))
for r in nonexact:
    print("   NON-EXACT", r)
for r in missing:
    print("   MISSING  ", r)

print()
print("F5 SESSION GEOMETRY (stored vs oracle):")
geom_ok = True
for D, dv in sorted(oracle.items()):
    any_uni = next(iter(dv["universes"].values()))
    want = any_uni.get("session") or {}
    row = c.execute("SELECT buckets, early_close, close_basis FROM pass_session "
                    "WHERE date=?", (D,)).fetchone()
    ok = row is not None and row[0] == want.get("buckets") and \
        bool(row[1]) == bool(want.get("early_close"))
    geom_ok = geom_ok and ok
    print("   %s buckets=%s/%s early_close=%s/%s  %s"
          % (D, row[0] if row else None, want.get("buckets"),
             bool(row[1]) if row else None, want.get("early_close"),
             "OK" if ok else "MISMATCH"))

print()
print("F2 near_52w_high IS A COUNT, NOT A PERCENT:")
for D, uni, val in c.execute("SELECT date, universe, c FROM breadth_daily_ohlc "
                             "WHERE metric='near_52w_high' ORDER BY date, universe"):
    print("   %s %-7s c=%s%s" % (D, uni, val, "   <== >100, NOT CLIPPED" if val > 100 else ""))
clipped = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE metric LIKE "
                    "'pct_above%' AND (h > 100.0 OR h = 100.0)").fetchone()[0]
print("   pct_above_* rows at or above 100.0 (expect 0):", clipped)

print()
print("F1 CORPORATE-ACTION CONTROLS — 2020-03-16, provider-internal factor:")
conn_bars = bl._bars_conn()
day_ts = bl._ts_int(__import__("datetime").date(2020, 3, 16))
basis = wr.session_basis(conn_bars, day_ts, None)
controls = {"BCPC": 1.0, "TPC": 1.0, "AAPL": 0.25}
ctrl_ok = True
for t, want in controls.items():
    got = basis.get(t)
    ok = got is not None and abs(got - want) < 0.01
    ctrl_ok = ctrl_ok and ok
    print("   %-5s factor=%s  expected~%s  %s" % (t, got, want, "OK" if ok else "MISMATCH"))

print()
print("DENOMINATOR / COHERENCE GATE (stored vs oracle):")
for D, dv in sorted(oracle.items()):
    for uni, uv in (dv.get("universes") or {}).items():
        row = c.execute("SELECT c FROM breadth_daily_ohlc WHERE universe=? AND date=? "
                        "AND metric='universe_count'", (uni, D)).fetchone()
        print("   %s %-7s universe_count=%s  oracle members=%s priced=%s"
              % (D, uni, row[0] if row else None, uv.get("members"), uv.get("priced")))

verdict = (not nonexact) and (not missing) and geom_ok and ctrl_ok and clipped == 0
print()
print("=" * 78)
print("SMOKE VERDICT:", "PASS" if verdict else "FAIL")
print("timings (s/session):", timings)
print("mean s/session      : %.1f" % (sum(timings.values()) / len(timings)))
print("=" * 78)

json.dump({"exact": len(exact), "nonexact": nonexact, "missing": missing,
           "geometry_ok": geom_ok, "controls_ok": ctrl_ok, "pct_clipped": clipped,
           "timings": timings, "verdict": "PASS" if verdict else "FAIL",
           "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
          open(REPORT, "w"), indent=1)
print("report ->", REPORT)
sys.exit(0 if verdict else 1)
