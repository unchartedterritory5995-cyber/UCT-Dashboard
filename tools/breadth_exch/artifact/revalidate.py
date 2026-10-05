"""Exchange Breadth V1 — critical revalidation of the repaired historical artifact.

Usage: python3 revalidate.py REPAIRED REPAIR_MANIFEST DIFF_JSON OUT_DIR

Runs validation part A (valA.py) against REPAIRED, re-runs the exact transfer-corpus checker against
the accepted ledger, and evaluates every gate explicitly. Writes OUT_DIR/REVALIDATION.json with
`pass` true only if ALL gates pass.
"""
import json
import os
import subprocess
import sys

REPAIRED, RMAN, DIFF, OUT = sys.argv[1:5]
HERE = os.path.dirname(os.path.abspath(__file__))
VALA = os.path.join(os.path.dirname(HERE), "validation", "valA.py")
X = "/data/_audit/exch_v1"
P1 = X + "/code_p1_d580df7fd222"
os.makedirs(OUT, exist_ok=True)
rman = json.load(open(RMAN))
env = dict(os.environ, EXCH_ART=REPAIRED, EXCH_ART_SHA=rman["repaired_sha256"])
p = subprocess.run([sys.executable, "-u", VALA, os.path.join(OUT, "A")], env=env, capture_output=True, text=True)
open(os.path.join(OUT, "A.log"), "w").write(p.stdout + p.stderr)
if p.returncode != 0:
    raise SystemExit("valA failed:\n" + p.stdout[-2000:] + p.stderr[-2000:])
A = {n: json.load(open(os.path.join(OUT, "A", f))) for n, f in (
    ("id", "A01_identity.json"), ("us", "A02_us_control.json"), ("cells", "A03_cells.json"),
    ("inv", "A04_invariants.json"), ("rec", "A05_reconstruction.json"), ("der", "A10_derived_prereqs.json"))}
# corpus: the exact accepted checker against the accepted ledger (symlinked into a scratch dir)
ck = os.path.join(OUT, "corpus")
os.makedirs(os.path.join(ck, "code"), exist_ok=True)
for fn, src in (("population.json", X + "/population.json"), ("venue_ledger.json", X + "/venue_ledger_72eef1c2.json")):
    if not os.path.exists(os.path.join(ck, fn)):
        os.symlink(src, os.path.join(ck, fn))
for fn in ("check_ledger.py", "breadth_venue_ledger.py"):
    open(os.path.join(ck, "code", fn), "wb").write(open(os.path.join(P1, fn), "rb").read())
cp = subprocess.run([sys.executable, os.path.join(ck, "code", "check_ledger.py"), ck, P1 + "/exchange_transfer_corpus.json"],
                    capture_output=True, text=True)
corpus = json.load(open(os.path.join(ck, "ledger_report.json")))
diff = json.load(open(DIFF))

RATIO_GAP = {u: {"ratio_5day": 4, "ratio_10day": 9} for u in ("us", "nasdaq", "nyse")}
STARTS = {"us": "2008-01-02", "nasdaq": "2008-01-02", "nyse": "2009-06-11"}
gates = {}
gates["01 quick_check"] = A["id"]["quick_check"] == [["ok"]]
gates["02 integrity_check"] = A["id"]["integrity_check"] == [["ok"]]
gates["03 identity: sha == repair manifest, ledger/inputs/frozen exact"] = (
    A["id"]["artifact"]["sha256"] == rman["repaired_sha256"] and A["id"]["artifact"]["sha_ok"]
    and A["id"]["ledger"]["ok"] and all(v["ok"] for v in A["id"]["inputs"].values()) and A["id"]["frozen"]["sha_ok"])
gates["04 exch_session 4712/4712"] = (A["inv"]["exch_session_rows"] == A["inv"]["done_sessions"] == 4712
                                      and A["inv"]["missing"] == [])
gates["05 population reconciliation (buckets, sizes, ledger coverage)"] = (
    not A["inv"]["violations"] and A["rec"]["overlapping_ledger_rows"] == 0
    and A["rec"]["member_sessions_without_ledger_row"] == 0)
gates["06 full US control"] = (A["us"]["pass"] and A["us"]["exact_matches"] == A["us"]["rows_compared"] == 164907)
gates["07 NYSE/Nasdaq sizes == exch_session (every session)"] = not any(
    k.startswith("es_") for k in A["inv"]["violations"])
gates["08 adv+dec+unc reconciliation"] = not any(k.startswith("adv_dec_unc") for k in A["inv"]["violations"])
gates["09 subset/disjoint (exchange sums <= us, no NYSE before start)"] = not any(
    k.startswith("exchange_sum_gt_us") or k.startswith("nyse_") or k == "conflict_members" for k in A["inv"]["violations"])
gates["10 no unexpected missing cells"] = all(
    A["cells"][u]["missing_metrics"] == RATIO_GAP[u] and A["cells"][u]["first"] == STARTS[u]
    and A["cells"][u]["missing_dates_are_first_sessions"] for u in RATIO_GAP)
gates["11 transfer corpus 51/51"] = corpus["corpus_pass"] == corpus["corpus_total"] == 51 and \
    corpus["member_sessions_without_ledger_row"] == 0
gates["12 the 13 ratio gaps are exactly the expected warm-up cells"] = all(
    A["cells"][u]["missing_n"] == 13 for u in RATIO_GAP)
gates["13 logical diff == +4 exch_session rows only"] = (
    diff["schema_identical"] and diff["pragmas_identical"] and diff["summary"] ==
    {"inserted": 4, "deleted": 0, "modified": 0, "tables_changed": ["exch_session"]})
gates["14 derived inputs: no adv/dec holes"] = all(
    not A["der"][u]["adv_dec_holes"] and not A["der"][u]["adv_plus_dec_zero"] for u in ("nyse", "nasdaq"))
rep = {"artifact": REPAIRED, "artifact_sha256": A["id"]["artifact"]["sha256"], "gates": gates,
       "pass": all(gates.values()), "corpus_stdout": cp.stdout.strip(),
       "us_control": {k: A["us"][k] for k in ("rows_compared", "exact_matches", "mismatches")},
       "exch_session": {"rows": A["inv"]["exch_session_rows"], "done": A["inv"]["done_sessions"]},
       "invariant_violations": A["inv"]["violations"],
       "cells": {u: {k: A["cells"][u][k] for k in ("sessions", "first", "last", "cells", "rectangular",
                                                   "missing_n", "missing_metrics")} for u in RATIO_GAP}}
json.dump(rep, open(os.path.join(OUT, "REVALIDATION.json"), "w"), indent=1, sort_keys=True)
print(json.dumps({"pass": rep["pass"], "failed": [g for g, ok in gates.items() if not ok]}, indent=1))
